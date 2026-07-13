// Runtime-overridable operational settings (admin-editable), stored as string key/values overlaying
// the env defaults. Keys: 'requireGuarantor', 'enforceRiderClearance', 'launchCity'.
export interface SettingsStore {
  getAll(): Promise<Record<string, string>>;
  setMany(patch: Record<string, string>): Promise<void>;
}
export const SETTINGS_STORE = Symbol('SETTINGS_STORE');
