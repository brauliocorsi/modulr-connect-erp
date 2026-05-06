import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/core/auth/AuthProvider";
import { RequireAuth } from "@/core/auth/RequireAuth";
import AppShell from "@/core/layout/AppShell";
import Login from "@/pages/Login";
import Home from "@/pages/Home";
import NotFound from "@/pages/NotFound";

import ProductsList from "@/modules/products/pages/ProductsList";
import CategoriesList from "@/modules/products/pages/CategoriesList";
import AttributesList from "@/modules/products/pages/AttributesList";
import BomList from "@/modules/products/pages/BomList";

import { QuotationsList, SalesOrdersList, CustomersList, PricelistsList } from "@/modules/sales/pages/SalesPages";
import { PurchaseOrdersList, SuppliersList } from "@/modules/purchase/pages/PurchasePages";
import {
  InventoryDashboard,
  TransfersList,
  AdjustmentsList,
  KardexList,
  LotsList,
  WarehousesList,
  LocationsList,
  ReorderingList,
} from "@/modules/inventory/pages/InventoryPages";
import { AppsSettings, UsersSettings, GroupsSettings, CompanySettings } from "@/modules/settings/pages/SettingsPages";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route index element={<Home />} />

              {/* Products */}
              <Route path="products" element={<ProductsList />} />
              <Route path="products/categories" element={<CategoriesList />} />
              <Route path="products/attributes" element={<AttributesList />} />
              <Route path="products/bom" element={<BomList />} />

              {/* Sales */}
              <Route path="sales" element={<Navigate to="/sales/quotations" replace />} />
              <Route path="sales/quotations" element={<QuotationsList />} />
              <Route path="sales/orders" element={<SalesOrdersList />} />
              <Route path="sales/customers" element={<CustomersList />} />
              <Route path="sales/pricelists" element={<PricelistsList />} />

              {/* Purchase */}
              <Route path="purchase" element={<Navigate to="/purchase/orders" replace />} />
              <Route path="purchase/orders" element={<PurchaseOrdersList />} />
              <Route path="purchase/suppliers" element={<SuppliersList />} />

              {/* Inventory */}
              <Route path="inventory" element={<InventoryDashboard />} />
              <Route path="inventory/transfers" element={<TransfersList />} />
              <Route path="inventory/adjustments" element={<AdjustmentsList />} />
              <Route path="inventory/kardex" element={<KardexList />} />
              <Route path="inventory/lots" element={<LotsList />} />
              <Route path="inventory/warehouses" element={<WarehousesList />} />
              <Route path="inventory/locations" element={<LocationsList />} />
              <Route path="inventory/reordering" element={<ReorderingList />} />

              {/* Settings */}
              <Route path="settings" element={<Navigate to="/settings/apps" replace />} />
              <Route path="settings/apps" element={<AppsSettings />} />
              <Route path="settings/users" element={<UsersSettings />} />
              <Route path="settings/groups" element={<GroupsSettings />} />
              <Route path="settings/company" element={<CompanySettings />} />

              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
