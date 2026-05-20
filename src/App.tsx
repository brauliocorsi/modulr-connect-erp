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
import ReceiptsPage from "@/modules/inventory/pages/ReceiptsPage";
import ShipmentsPage from "@/modules/inventory/pages/ShipmentsPage";
import InternalTransfersPage from "@/modules/inventory/pages/InternalTransfersPage";
import BackordersPage from "@/modules/inventory/pages/BackordersPage";
import LocationsTreePage from "@/modules/inventory/pages/LocationsTreePage";
import BinsPage from "@/modules/inventory/pages/BinsPage";
import PricelistForm from "@/modules/sales/pages/PricelistForm";
import DeliveryRulesPage from "@/modules/sales/pages/DeliveryRulesPage";
import SalesStockPage from "@/modules/sales/pages/SalesStockPage";
import GroupForm from "@/modules/settings/pages/GroupForm";
import RfqKanban from "@/modules/purchase/pages/RfqKanban";
import PurchaseNeedsList from "@/modules/purchase/pages/PurchaseNeedsList";
import PaymentsPage from "@/modules/finance/pages/PaymentsPage";
import { JournalsList, JournalForm, MethodsList, MethodForm, CostCentersList, CostCenterForm } from "@/modules/finance/pages/FinancePages";
import FinanceDashboard from "@/modules/finance/pages/FinanceDashboard";
import ReceivablesPage from "@/modules/finance/pages/ReceivablesPage";
import PendingConfirmationsPage from "@/modules/finance/pages/PendingConfirmationsPage";
import PayablesList from "@/modules/finance/pages/PayablesList";
import BillForm from "@/modules/finance/pages/BillForm";
import ReconciliationPage from "@/modules/finance/pages/ReconciliationPage";
import CustomerCreditsPage from "@/modules/finance/pages/CustomerCreditsPage";
import CashRegistersList from "@/modules/cashbox/pages/CashRegistersList";
import CashRegisterDetail from "@/modules/cashbox/pages/CashRegisterDetail";
import CashSessionDetail from "@/modules/cashbox/pages/CashSessionDetail";
import DriverHandoversPage from "@/modules/finance/pages/DriverHandoversPage";
import RecurringExpensesPage from "@/modules/finance/pages/RecurringExpensesPage";
import { ServiceRequestsList, ServiceRequestForm } from "@/modules/service/pages/ServicePages";

import { QuotationsList, SalesOrdersList, CustomersList, PricelistsList } from "@/modules/sales/pages/SalesPages";
import { PurchaseOrdersList, SuppliersList } from "@/modules/purchase/pages/PurchasePages";
import {
  InventoryDashboard,
  AdjustmentsList,
  KardexList,
  LotsList,
  WarehousesList,
  LocationsList,
  ReorderingList,
} from "@/modules/inventory/pages/InventoryPages";
import TransfersList from "@/modules/inventory/pages/TransfersList";
import BatchesList from "@/modules/inventory/pages/BatchesList";
import BatchForm from "@/modules/inventory/pages/BatchForm";
import WavesList from "@/modules/inventory/pages/WavesList";
import WaveForm from "@/modules/inventory/pages/WaveForm";
import BarcodeScanPage from "@/modules/inventory/pages/BarcodeScanPage";
import BarcodeShell from "@/modules/barcode/BarcodeShell";
import BarcodeHome from "@/modules/barcode/BarcodeHome";
import PickingScan from "@/modules/barcode/PickingScan";
import BatchScan from "@/modules/barcode/BatchScan";
import WaveScan from "@/modules/barcode/WaveScan";
import ProductLookup from "@/modules/barcode/ProductLookup";
import LocationLookup from "@/modules/barcode/LocationLookup";
import PutawayScan from "@/modules/barcode/PutawayScan";
import VehiclesList from "@/modules/inventory/pages/VehiclesList";
import VehicleForm from "@/modules/inventory/pages/VehicleForm";
import CarriersList from "@/modules/inventory/pages/CarriersList";
import CarrierForm from "@/modules/inventory/pages/CarrierForm";
import DeliveryShell from "@/modules/delivery/DeliveryShell";
import DeliveryHome from "@/modules/delivery/pages/DeliveryHome";
import DeliveryBatch from "@/modules/delivery/pages/DeliveryBatch";
import DeliveryPicking from "@/modules/delivery/pages/DeliveryPicking";
import DeliveryCashbox from "@/modules/delivery/pages/DeliveryCashbox";
import { AppsSettings, UsersSettings, UserForm, GroupsSettings, CompanySettings } from "@/modules/settings/pages/SettingsPages";
import StoresList from "@/modules/settings/pages/StoresList";
import StoreForm from "@/modules/settings/pages/StoreForm";
import { StockOnHandReport, SalesReport, PurchaseReport } from "@/modules/reports/pages/ReportsPages";
import Discuss from "@/modules/discuss/Discuss";
import DemoFlowPage from "@/modules/demo/DemoFlowPage";
import RoutesShell from "@/modules/routes/RoutesShell";
import RoutesSchedule from "@/modules/routes/pages/RoutesSchedule";
import ZonesList from "@/modules/routes/pages/ZonesList";
import ZoneForm from "@/modules/routes/pages/ZoneForm";
import RouteDetail from "@/modules/routes/pages/RouteDetail";
import {
  EmployeesList, EmployeeForm, DepartmentsList, DepartmentForm,
  LeavesList, LeaveForm, AttendanceClock, AttendancesList,
} from "@/modules/hr/pages/HrPages";
import ManufacturingDashboard from "@/modules/manufacturing/pages/ManufacturingDashboard";
import ManufacturingOrdersList from "@/modules/manufacturing/pages/ManufacturingOrdersList";
import ManufacturingOrderDetail from "@/modules/manufacturing/pages/ManufacturingOrderDetail";
import ManufacturingPlanning from "@/modules/manufacturing/pages/ManufacturingPlanning";
import ShopFloorBoard from "@/modules/shopfloor/pages/ShopFloorBoard";
import ShopFloorOrder from "@/modules/shopfloor/pages/ShopFloorOrder";
import ShopFloorQuality from "@/modules/shopfloor/pages/ShopFloorQuality";
import PickupsPage from "@/modules/m5/pages/PickupsPage";
import CarrierShipmentsPage from "@/modules/m5/pages/CarrierShipmentsPage";
import CustomerTicketsList from "@/modules/helpdesk/pages/CustomerTicketsList";
import CustomerTicketDetail from "@/modules/helpdesk/pages/CustomerTicketDetail";
import CustomerPortalPage from "@/modules/portal/pages/CustomerPortalPage";
import PortalTokensPage from "@/modules/helpdesk/pages/PortalTokensPage";
import WorkCentersPage from "@/modules/manufacturing/pages/WorkCentersPage";
import OperationsPage from "@/modules/manufacturing/pages/OperationsPage";
import DamagedStockPage from "@/modules/inventory/pages/DamagedStockPage";
import QuarantinePage from "@/modules/inventory/pages/QuarantinePage";
import ServiceRepairsPage from "@/modules/service/pages/ServiceRepairsPage";
import IndicatorsPage from "@/modules/indicators/pages/IndicatorsPage";

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

            {/* Public Customer Portal */}
            <Route path="/portal/:token" element={<CustomerPortalPage />} />

            {/* Delivery app (layout próprio) */}
            <Route path="/delivery" element={<RequireAuth><DeliveryShell /></RequireAuth>}>
              <Route index element={<DeliveryHome />} />
              <Route path="batch/:id" element={<DeliveryBatch />} />
              <Route path="picking/:id" element={<DeliveryPicking />} />
              <Route path="cashbox" element={<DeliveryCashbox />} />
            </Route>

            <Route
              path="/"
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route index element={<Home />} />
              <Route path="indicators" element={<IndicatorsPage />} />


              {/* Barcode app (dentro do ERP) */}
              <Route path="barcode" element={<BarcodeShell />}>
                <Route index element={<BarcodeHome />} />
                <Route path="op/:kind" element={<PickingScan />} />
                <Route path="batches" element={<BatchScan />} />
                <Route path="waves" element={<WaveScan />} />
                <Route path="lookup/product" element={<ProductLookup />} />
                <Route path="lookup/location" element={<LocationLookup />} />
                <Route path="putaway" element={<PutawayScan />} />
              </Route>

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
              <Route path="sales/delivery-rules" element={<DeliveryRulesPage />} />
              <Route path="sales/stock" element={<SalesStockPage />} />

              {/* Purchase */}
              <Route path="purchase" element={<Navigate to="/purchase/orders" replace />} />
              <Route path="purchase/orders" element={<PurchaseOrdersList />} />
              <Route path="purchase/kanban" element={<RfqKanban />} />
              <Route path="purchase/needs" element={<PurchaseNeedsList />} />
              <Route path="purchase/orders/new" element={<OrderForm kind="purchase" />} />
              <Route path="purchase/orders/:id" element={<OrderForm kind="purchase" />} />
              <Route path="purchase/suppliers" element={<SuppliersList />} />
              <Route path="purchase/suppliers/new" element={<PartnerForm defaultKind="supplier" />} />
              <Route path="purchase/suppliers/:id" element={<PartnerForm defaultKind="supplier" />} />

              {/* Inventory */}
              <Route path="inventory" element={<InventoryDashboard />} />
              <Route path="inventory/transfers" element={<TransfersList />} />
              <Route path="inventory/transfers/:id" element={<TransferForm />} />
              <Route path="inventory/batches" element={<BatchesList />} />
              <Route path="inventory/batches/:id" element={<BatchForm />} />
              <Route path="inventory/waves" element={<WavesList />} />
              <Route path="inventory/waves/new" element={<WaveForm />} />
              <Route path="inventory/waves/:id" element={<WaveForm />} />
              <Route path="inventory/barcode" element={<BarcodeScanPage />} />
              <Route path="inventory/schedule" element={<SchedulePage />} />
              <Route path="inventory/moves" element={<MovesPage />} />
              <Route path="inventory/receipts" element={<ReceiptsPage />} />
              <Route path="inventory/shipments" element={<ShipmentsPage />} />
              <Route path="inventory/internal-transfers" element={<InternalTransfersPage />} />
              <Route path="inventory/backorders" element={<BackordersPage />} />
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
              <Route path="inventory/locations-tree" element={<LocationsTreePage />} />
              <Route path="inventory/bins" element={<BinsPage />} />
              <Route path="inventory/reordering" element={<ReorderingList />} />
              <Route path="inventory/reordering/new" element={<ReorderingForm />} />
              <Route path="inventory/reordering/:id" element={<ReorderingForm />} />
              <Route path="inventory/vehicles" element={<VehiclesList />} />
              <Route path="inventory/vehicles/new" element={<VehicleForm />} />
              <Route path="inventory/vehicles/:id" element={<VehicleForm />} />

              <Route path="inventory/carriers" element={<CarriersList />} />
              <Route path="inventory/carriers/new" element={<CarrierForm />} />
              <Route path="inventory/carriers/:id" element={<CarrierForm />} />

              {/* Settings */}
              <Route path="settings" element={<Navigate to="/settings/apps" replace />} />
              <Route path="settings/apps" element={<AppsSettings />} />
              <Route path="settings/users" element={<UsersSettings />} />
              <Route path="settings/users/:id" element={<UserForm />} />
              <Route path="settings/groups" element={<GroupsSettings />} />
              <Route path="settings/groups/new" element={<GroupForm />} />
              <Route path="settings/groups/:id" element={<GroupForm />} />
              <Route path="settings/company" element={<CompanySettings />} />
              <Route path="settings/stores" element={<StoresList />} />
              <Route path="settings/stores/new" element={<StoreForm />} />
              <Route path="settings/stores/:id" element={<StoreForm />} />

              {/* Reports */}
              <Route path="reports/stock" element={<StockOnHandReport />} />
              <Route path="reports/sales" element={<SalesReport />} />
              <Route path="reports/purchase" element={<PurchaseReport />} />

              {/* Finance */}
              <Route path="finance" element={<FinanceDashboard />} />
              <Route path="finance/payments" element={<PaymentsPage />} />
              <Route path="finance/receivables" element={<ReceivablesPage />} />
              <Route path="finance/pending" element={<PendingConfirmationsPage />} />
              <Route path="finance/reconciliation" element={<ReconciliationPage />} />
              <Route path="finance/credits" element={<CustomerCreditsPage />} />
              <Route path="finance/payables" element={<PayablesList />} />
              <Route path="finance/payables/new" element={<BillForm />} />
              <Route path="finance/payables/:id" element={<BillForm />} />
              <Route path="finance/handovers" element={<DriverHandoversPage />} />
              <Route path="finance/recurring" element={<RecurringExpensesPage />} />

              {/* Assistência */}
              <Route path="service" element={<Navigate to="/service/requests" replace />} />
              <Route path="service/requests" element={<ServiceRequestsList />} />
              <Route path="service/requests/new" element={<ServiceRequestForm />} />
              <Route path="service/requests/:id" element={<ServiceRequestForm />} />
              <Route path="service/repairs" element={<ServiceRepairsPage />} />

              {/* Helpdesk */}
              <Route path="helpdesk" element={<Navigate to="/helpdesk/tickets" replace />} />
              <Route path="helpdesk/tickets" element={<CustomerTicketsList />} />
              <Route path="helpdesk/tickets/:id" element={<CustomerTicketDetail />} />
              <Route path="helpdesk/portal-tokens" element={<PortalTokensPage />} />

              {/* Cashbox */}
              <Route path="cashbox" element={<CashRegistersList />} />
              <Route path="cashbox/sessions/:id" element={<CashSessionDetail />} />
              <Route path="cashbox/:id" element={<CashRegisterDetail />} />

              <Route path="finance/journals" element={<JournalsList />} />
              <Route path="finance/journals/new" element={<JournalForm />} />
              <Route path="finance/journals/:id" element={<JournalForm />} />
              <Route path="finance/methods" element={<MethodsList />} />
              <Route path="finance/methods/new" element={<MethodForm />} />
              <Route path="finance/methods/:id" element={<MethodForm />} />
              <Route path="finance/cost_centers" element={<CostCentersList />} />
              <Route path="finance/cost_centers/new" element={<CostCenterForm />} />
              <Route path="finance/cost_centers/:id" element={<CostCenterForm />} />

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

              {/* Demo */}
              <Route path="demo/flow" element={<DemoFlowPage />} />

              {/* Routes / Rotas */}
              <Route path="routes" element={<RoutesShell />}>
                <Route index element={<RoutesSchedule />} />
                <Route path="zones" element={<ZonesList />} />
                <Route path="zones/new" element={<ZoneForm />} />
                <Route path="zones/:id" element={<ZoneForm />} />
                <Route path=":id" element={<RouteDetail />} />
              </Route>

              {/* M5 — Pickups & Carriers */}
              <Route path="m5/pickups" element={<PickupsPage />} />
              <Route path="m5/carrier" element={<CarrierShipmentsPage />} />

              {/* Manufacturing */}
              <Route path="manufacturing" element={<ManufacturingDashboard />} />
              <Route path="manufacturing/orders" element={<ManufacturingOrdersList />} />
              <Route path="manufacturing/orders/:id" element={<ManufacturingOrderDetail />} />
              <Route path="manufacturing/planning" element={<ManufacturingPlanning />} />
              <Route path="manufacturing/work-centers" element={<WorkCentersPage />} />
              <Route path="manufacturing/operations" element={<OperationsPage />} />
              <Route path="manufacturing/bom" element={<Navigate to="/products/bom" replace />} />

              {/* Inventory — Damaged / Quarantine */}
              <Route path="inventory/damaged" element={<DamagedStockPage />} />
              <Route path="inventory/quarantine" element={<QuarantinePage />} />

              {/* Shop Floor */}
              <Route path="shop-floor" element={<ShopFloorBoard />} />
              <Route path="shop-floor/order/:id" element={<ShopFloorOrder />} />
              <Route path="shop-floor/quality" element={<ShopFloorQuality />} />

              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
