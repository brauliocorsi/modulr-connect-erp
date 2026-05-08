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
import ProductForm from "@/modules/products/pages/ProductForm";
import PartnerForm from "@/modules/partners/pages/PartnerForm";
import OrderForm from "@/core/orders/OrderForm";
import TransferForm from "@/modules/inventory/pages/TransferForm";
import CategoriesList from "@/modules/products/pages/CategoriesList";
import CategoryForm from "@/modules/products/pages/CategoryForm";
import AttributesList from "@/modules/products/pages/AttributesList";
import AttributeForm from "@/modules/products/pages/AttributeForm";
import BomList from "@/modules/products/pages/BomList";
import BomForm from "@/modules/products/pages/BomForm";
import WarehouseForm from "@/modules/inventory/pages/WarehouseForm";
import LocationForm from "@/modules/inventory/pages/LocationForm";
import ReorderingForm from "@/modules/inventory/pages/ReorderingForm";
import LotForm from "@/modules/inventory/pages/LotForm";
import AdjustmentForm from "@/modules/inventory/pages/AdjustmentForm";
import SchedulePage from "@/modules/inventory/pages/SchedulePage";
import MovesPage from "@/modules/inventory/pages/MovesPage";
import PricelistForm from "@/modules/sales/pages/PricelistForm";
import GroupForm from "@/modules/settings/pages/GroupForm";
import RfqKanban from "@/modules/purchase/pages/RfqKanban";

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
import { StockOnHandReport, SalesReport, PurchaseReport } from "@/modules/reports/pages/ReportsPages";
import Discuss from "@/modules/discuss/Discuss";
import {
  EmployeesList, EmployeeForm, DepartmentsList, DepartmentForm,
  LeavesList, LeaveForm, AttendanceClock, AttendancesList,
} from "@/modules/hr/pages/HrPages";

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
              <Route path="products/new" element={<ProductForm />} />
              <Route path="products/:id" element={<ProductForm />} />
              <Route path="products/categories" element={<CategoriesList />} />
              <Route path="products/categories/new" element={<CategoryForm />} />
              <Route path="products/categories/:id" element={<CategoryForm />} />
              <Route path="products/attributes" element={<AttributesList />} />
              <Route path="products/attributes/new" element={<AttributeForm />} />
              <Route path="products/attributes/:id" element={<AttributeForm />} />
              <Route path="products/bom" element={<BomList />} />
              <Route path="products/bom/new" element={<BomForm />} />
              <Route path="products/bom/:id" element={<BomForm />} />

              {/* Sales */}
              <Route path="sales" element={<Navigate to="/sales/quotations" replace />} />
              <Route path="sales/quotations" element={<QuotationsList />} />
              <Route path="sales/orders" element={<SalesOrdersList />} />
              <Route path="sales/orders/new" element={<OrderForm kind="sale" />} />
              <Route path="sales/orders/:id" element={<OrderForm kind="sale" />} />
              <Route path="sales/customers" element={<CustomersList />} />
              <Route path="sales/customers/new" element={<PartnerForm defaultKind="customer" />} />
              <Route path="sales/customers/:id" element={<PartnerForm defaultKind="customer" />} />
              <Route path="sales/pricelists" element={<PricelistsList />} />
              <Route path="sales/pricelists/new" element={<PricelistForm />} />
              <Route path="sales/pricelists/:id" element={<PricelistForm />} />

              {/* Purchase */}
              <Route path="purchase" element={<Navigate to="/purchase/orders" replace />} />
              <Route path="purchase/orders" element={<PurchaseOrdersList />} />
              <Route path="purchase/kanban" element={<RfqKanban />} />
              <Route path="purchase/orders/new" element={<OrderForm kind="purchase" />} />
              <Route path="purchase/orders/:id" element={<OrderForm kind="purchase" />} />
              <Route path="purchase/suppliers" element={<SuppliersList />} />
              <Route path="purchase/suppliers/new" element={<PartnerForm defaultKind="supplier" />} />
              <Route path="purchase/suppliers/:id" element={<PartnerForm defaultKind="supplier" />} />

              {/* Inventory */}
              <Route path="inventory" element={<InventoryDashboard />} />
              <Route path="inventory/transfers" element={<TransfersList />} />
              <Route path="inventory/transfers/:id" element={<TransferForm />} />
              <Route path="inventory/adjustments" element={<AdjustmentsList />} />
              <Route path="inventory/adjustments/new" element={<AdjustmentForm />} />
              <Route path="inventory/adjustments/:id" element={<AdjustmentForm />} />
              <Route path="inventory/kardex" element={<KardexList />} />
              <Route path="inventory/lots" element={<LotsList />} />
              <Route path="inventory/lots/new" element={<LotForm />} />
              <Route path="inventory/lots/:id" element={<LotForm />} />
              <Route path="inventory/warehouses" element={<WarehousesList />} />
              <Route path="inventory/warehouses/new" element={<WarehouseForm />} />
              <Route path="inventory/warehouses/:id" element={<WarehouseForm />} />
              <Route path="inventory/locations" element={<LocationsList />} />
              <Route path="inventory/locations/new" element={<LocationForm />} />
              <Route path="inventory/locations/:id" element={<LocationForm />} />
              <Route path="inventory/reordering" element={<ReorderingList />} />
              <Route path="inventory/reordering/new" element={<ReorderingForm />} />
              <Route path="inventory/reordering/:id" element={<ReorderingForm />} />

              {/* Settings */}
              <Route path="settings" element={<Navigate to="/settings/apps" replace />} />
              <Route path="settings/apps" element={<AppsSettings />} />
              <Route path="settings/users" element={<UsersSettings />} />
              <Route path="settings/groups" element={<GroupsSettings />} />
              <Route path="settings/groups/new" element={<GroupForm />} />
              <Route path="settings/groups/:id" element={<GroupForm />} />
              <Route path="settings/company" element={<CompanySettings />} />

              {/* Reports */}
              <Route path="reports/stock" element={<StockOnHandReport />} />
              <Route path="reports/sales" element={<SalesReport />} />
              <Route path="reports/purchase" element={<PurchaseReport />} />

              {/* HR */}
              <Route path="hr" element={<Navigate to="/hr/employees" replace />} />
              <Route path="hr/employees" element={<EmployeesList />} />
              <Route path="hr/employees/new" element={<EmployeeForm />} />
              <Route path="hr/employees/:id" element={<EmployeeForm />} />
              <Route path="hr/departments" element={<DepartmentsList />} />
              <Route path="hr/departments/new" element={<DepartmentForm />} />
              <Route path="hr/departments/:id" element={<DepartmentForm />} />
              <Route path="hr/leaves" element={<LeavesList />} />
              <Route path="hr/leaves/new" element={<LeaveForm />} />
              <Route path="hr/leaves/:id" element={<LeaveForm />} />
              <Route path="hr/attendance" element={<AttendanceClock />} />
              <Route path="hr/attendances" element={<AttendancesList />} />

              {/* Discuss */}
              <Route path="discuss" element={<Discuss />} />
              <Route path="discuss/:channelId" element={<Discuss />} />


              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
