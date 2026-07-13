export interface Rating {
  id: string;
  jobId: string;
  riderId: string;
  customerId: string;
  stars: number;
  comment?: string;
  createdAt: number;
}
export interface NewRating {
  jobId: string;
  riderId: string;
  customerId: string;
  stars: number;
  comment?: string;
}

export interface RatingRepo {
  add(rating: NewRating): Promise<Rating>;
  findByJob(jobId: string): Promise<Rating | null>;
  /** Every star value a rider has received (for the running average). */
  listStarsByRider(riderId: string): Promise<number[]>;
}
export const RATING_REPO = Symbol('RATING_REPO');
