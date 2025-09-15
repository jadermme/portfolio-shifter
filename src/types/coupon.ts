export interface IndividualCoupon {
  id: string;
  date: string;
  value: number;
}

export interface CouponSummary {
  total: number;
  coupons: IndividualCoupon[];
}