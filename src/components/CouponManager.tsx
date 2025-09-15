import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, CalendarIcon, Edit } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { IndividualCoupon, CouponSummary } from '@/types/coupon';
import { cn } from '@/lib/utils';

interface CouponManagerProps {
  couponData: CouponSummary;
  onChange: (couponData: CouponSummary) => void;
  assetKey: string;
}

export const CouponManager: React.FC<CouponManagerProps> = ({ couponData, onChange, assetKey }) => {
  const [editingCoupon, setEditingCoupon] = useState<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState<string | null>(null);
  
  // Sort coupons by date (ascending)
  const sortedCoupons = [...couponData.coupons].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  const formatCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    });
  };

  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return 'Não informado';
    try {
      return format(new Date(dateStr), 'dd/MM/yyyy', { locale: ptBR });
    } catch {
      return 'Data inválida';
    }
  };
  
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
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Label className="text-lg font-semibold">Cupons Recebidos Individualmente</Label>
          <p className="text-sm text-muted-foreground mt-1">
            {couponData.coupons.length} cupons cadastrados
          </p>
        </div>
        <Badge variant="outline" className="bg-financial-success/10 text-financial-success border-financial-success/20 px-4 py-2 text-base font-semibold">
          Total: {formatCurrency(couponData.total)}
        </Badge>
      </div>

      {/* Table Section */}
      {couponData.coupons.length > 0 ? (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-16 font-semibold">Nº</TableHead>
                <TableHead className="font-semibold">Data do Recebimento</TableHead>
                <TableHead className="font-semibold">Valor (R$)</TableHead>
                <TableHead className="w-24 text-center font-semibold">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedCoupons.map((coupon, index) => (
                <TableRow 
                  key={coupon.id} 
                  className={cn(
                    "transition-colors hover:bg-muted/50",
                    index % 2 === 0 ? "bg-background" : "bg-muted/20"
                  )}
                >
                  <TableCell className="font-medium text-primary">
                    {index + 1}
                  </TableCell>
                  
                  <TableCell>
                    <Popover 
                      open={datePickerOpen === coupon.id} 
                      onOpenChange={(open) => setDatePickerOpen(open ? coupon.id : null)}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          className={cn(
                            "w-full justify-start text-left font-normal h-9 px-3",
                            !coupon.date && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {formatDateDisplay(coupon.date)}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={coupon.date ? new Date(coupon.date) : undefined}
                          onSelect={(date) => {
                            if (date) {
                              updateCoupon(coupon.id, 'date', format(date, 'yyyy-MM-dd'));
                            }
                            setDatePickerOpen(null);
                          }}
                          initialFocus
                          className="pointer-events-auto"
                          locale={ptBR}
                        />
                      </PopoverContent>
                    </Popover>
                  </TableCell>
                  
                  <TableCell>
                    {editingCoupon === coupon.id ? (
                      <Input
                        type="number"
                        step="0.01"
                        value={coupon.value || ''}
                        onChange={(e) => updateCoupon(coupon.id, 'value', parseFloat(e.target.value) || 0)}
                        onBlur={() => setEditingCoupon(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === 'Escape') {
                            setEditingCoupon(null);
                          }
                        }}
                        className="h-8"
                        autoFocus
                      />
                    ) : (
                      <Button
                        variant="ghost"
                        className="w-full justify-start text-left font-normal h-8 px-3"
                        onClick={() => setEditingCoupon(coupon.id)}
                      >
                        {formatCurrency(coupon.value)}
                      </Button>
                    )}
                  </TableCell>
                  
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingCoupon(coupon.id)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
                        title="Editar valor"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeCoupon(coupon.id)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        title="Excluir cupom"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          <p className="mb-2">Nenhum cupom cadastrado ainda.</p>
          <p className="text-sm">Clique no botão abaixo para adicionar o primeiro cupom.</p>
        </div>
      )}

      {/* Add Coupon Button */}
      <div className="flex justify-center">
        <Button
          type="button"
          variant="outline"
          onClick={addCoupon}
          className="gap-2 px-6"
        >
          <Plus className="h-4 w-4" />
          Adicionar Cupom
        </Button>
      </div>
    </div>
  );
};