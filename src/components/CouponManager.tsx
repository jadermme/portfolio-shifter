import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, Plus } from 'lucide-react';
import { IndividualCoupon, CouponSummary } from '@/types/coupon';

interface CouponManagerProps {
  couponData: CouponSummary;
  onChange: (couponData: CouponSummary) => void;
  assetKey: string;
}

export const CouponManager: React.FC<CouponManagerProps> = ({ couponData, onChange, assetKey }) => {
  
  const addCoupon = () => {
    const newCoupon: IndividualCoupon = {
      id: Math.random().toString(36).substr(2, 9),
      date: '',
      value: 0
    };
    
    const updatedCoupons = [...couponData.coupons, newCoupon];
    const updatedData: CouponSummary = {
      coupons: updatedCoupons,
      total: updatedCoupons.reduce((sum, coupon) => sum + coupon.value, 0)
    };
    
    onChange(updatedData);
  };

  const removeCoupon = (id: string) => {
    const updatedCoupons = couponData.coupons.filter(coupon => coupon.id !== id);
    const updatedData: CouponSummary = {
      coupons: updatedCoupons,
      total: updatedCoupons.reduce((sum, coupon) => sum + coupon.value, 0)
    };
    
    onChange(updatedData);
  };

  const updateCoupon = (id: string, field: 'date' | 'value', value: string | number) => {
    const updatedCoupons = couponData.coupons.map(coupon => 
      coupon.id === id 
        ? { ...coupon, [field]: value }
        : coupon
    );
    
    const updatedData: CouponSummary = {
      coupons: updatedCoupons,
      total: updatedCoupons.reduce((sum, coupon) => sum + coupon.value, 0)
    };
    
    onChange(updatedData);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Cupons Recebidos Individualmente</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addCoupon}
          className="h-8 px-3"
        >
          <Plus className="h-4 w-4 mr-1" />
          Adicionar Cupom
        </Button>
      </div>

      {couponData.coupons.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">
              Lista de Cupons
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {couponData.coupons.map((coupon, index) => (
              <div key={coupon.id} className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg">
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Data do Recebimento
                    </Label>
                    <Input
                      type="date"
                      value={coupon.date}
                      onChange={(e) => updateCoupon(coupon.id, 'date', e.target.value)}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Valor (R$)
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={coupon.value || ''}
                      onChange={(e) => updateCoupon(coupon.id, 'value', parseFloat(e.target.value) || 0)}
                      className="h-8"
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeCoupon(coupon.id)}
                  className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="p-3 bg-muted/50 rounded-lg">
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium">Total de Cupons:</span>
          <span className="text-lg font-bold text-financial-success">
            R$ {couponData.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </span>
        </div>
      </div>
    </div>
  );
};