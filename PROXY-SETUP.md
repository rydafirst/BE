# Free static-IP proxy for Flutterwave payouts (Oracle Cloud + tinyproxy)

Flutterwave's Transfers (payout) API only accepts requests from **whitelisted IPv4 addresses**.
Railway (non-Pro) has no static outbound IPv4, so we route Flutterwave calls through a tiny proxy
running on a **free** VM that DOES have a fixed public IP. Total cost: **$0/month**.

The backend already supports this: set `FLW_PROXY_URL` and every Flutterwave request egresses from the
proxy's IP. Nothing else (maps, push, etc.) uses the proxy.

---

## 1. Create the free VM (one-time, ~10 min)

1. Sign up at **Oracle Cloud** → the **Always Free** tier includes a permanent VM + public IP.
   (Google Cloud `e2-micro` free tier or AWS free tier work too — any host with a static public IPv4.)
2. Create a **Compute instance**:
   - Image: **Ubuntu 22.04**
   - Shape: an **Always Free-eligible** shape (e.g. `VM.Standard.E2.1.Micro` or Ampere `A1`)
   - Add your SSH public key.
3. Give it a **Reserved (static) public IP** so it never changes:
   - Networking → the instance's VNIC → edit the public IP → **Reserved**.
4. **Write down the public IPv4** — this is the address you'll whitelist in Flutterwave.

## 2. Open the proxy port

**In Oracle Cloud** (VCN → Security List, or the instance's NSG): add an **Ingress rule**
- Source `0.0.0.0/0`, IP protocol **TCP**, destination port **8888**.
  (Access is still protected by the proxy password in step 3 — it's not an open relay.)

**On the VM** (Oracle Ubuntu images also block ports with iptables):
```bash
sudo iptables -I INPUT 6 -p tcp --dport 8888 -j ACCEPT
sudo netfilter-persistent save      # persist across reboots (install: sudo apt install -y iptables-persistent)
```

## 3. Install and configure tinyproxy

```bash
sudo apt update && sudo apt install -y tinyproxy
```

Edit `/etc/tinyproxy/tinyproxy.conf` (`sudo nano /etc/tinyproxy/tinyproxy.conf`) so it has:
```
Port 8888
Listen 0.0.0.0
Timeout 600

# Require a username/password so this is NOT an open proxy. Pick a long random password.
BasicAuth rydauser CHANGE_ME_TO_A_LONG_RANDOM_PASSWORD

# Comment out ALL "Allow 127.0.0.1"/"Allow ::1" lines — with them present tinyproxy only accepts
# localhost. With none, it accepts any client, but BasicAuth above still gates every request.

# Optional hardening: only allow HTTPS CONNECT to Flutterwave, so even a leaked password is useless
# for anything else.
ConnectPort 443
Filter "/etc/tinyproxy/filter"
FilterDefaultDeny Yes
FilterExtended On
```

If you added the `Filter` lines, create `/etc/tinyproxy/filter`:
```
(^|\.)flutterwave\.com$
```

Restart and confirm it's listening:
```bash
sudo systemctl restart tinyproxy
sudo systemctl enable tinyproxy
sudo ss -lntp | grep 8888
```

Quick self-test from the VM (should return JSON, not an auth error):
```bash
curl -x http://rydauser:YOUR_PASSWORD@127.0.0.1:8888 https://api.flutterwave.com/v3/banks/NG -I
```

## 4. Point the backend at the proxy

In **Railway → BE → Variables**, add:
```
FLW_PROXY_URL = http://rydauser:YOUR_PASSWORD@YOUR_VM_PUBLIC_IP:8888
```
Then **redeploy** the BE service (env + the new proxy code must both be live).

## 5. Whitelist the IP in Flutterwave

Flutterwave dashboard → **Settings → Whitelisted IP addresses** → add **YOUR_VM_PUBLIC_IP** →
complete the OTP (email + WhatsApp). Also confirm **Transfer via API** is enabled.

## 6. Pay the stranded rider

The failed payout is queued (`payoutPending`). Retry it (idempotent — no double-pay):
- Admin finance queue in the portal, or
- `POST /v1/admin/finance/payouts/:jobId/retry`

## Verify end-to-end

After redeploy, trigger a payout (or the retry above) and check the BE deploy logs:
- **Success:** no `Rider payout failed` line; the job's `payoutPending` clears.
- **Still failing with "enable IP Whitelisting":** the proxy IP isn't the one Flutterwave sees — re-check
  that `FLW_PROXY_URL` points at the VM's *public* IP and that you redeployed.

## Security notes

- The proxy password keeps it from being an open relay; the optional Filter limits it to Flutterwave only.
- `FLW_PROXY_URL` is a secret (it contains the password) — keep it only in Railway Variables, never in git.
- Keep the VM patched: `sudo apt update && sudo apt upgrade -y` occasionally.
