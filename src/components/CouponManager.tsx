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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left section - Add button and title */}
        <div className="lg:col-span-1">
          <div className="flex flex-col space-y-3">
            <Label className="text-sm font-medium">Cupons Recebidos Individualmente</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addCoupon}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-1" />
              Adicionar Cupom
            </Button>
          </div>
        </div>

        {/* Right section - Total */}
        <div className="lg:col-span-2">
          <div className="p-4 bg-muted/50 rounded-lg h-full flex items-center justify-center">
            <div className="text-center">
              <div className="text-sm text-muted-foreground mb-1">Total de Cupons</div>
              <div className="text-2xl font-bold text-financial-success">
                R$ {couponData.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {couponData.coupons.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">
              Lista de Cupons ({couponData.coupons.length} cupons cadastrados)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-3">
              {couponData.coupons.map((coupon, index) => (
                <div key={coupon.id} className="p-3 bg-muted/30 rounded-lg space-y-2">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Cupom #{index + 1}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCoupon(coupon.id)}
                      className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="space-y-2">
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
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};