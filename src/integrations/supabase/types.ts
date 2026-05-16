export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      _m3_test_result: {
        Row: {
          id: number
          ran_at: string | null
          result: Json | null
        }
        Insert: {
          id?: number
          ran_at?: string | null
          result?: Json | null
        }
        Update: {
          id?: number
          ran_at?: string | null
          result?: Json | null
        }
        Relationships: []
      }
      account_journals: {
        Row: {
          active: boolean
          code: string
          created_at: string
          currency: string
          id: string
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          currency?: string
          id?: string
          name: string
          type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          currency?: string
          id?: string
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      bom_lines: {
        Row: {
          bom_id: string
          component_product_id: string
          component_variant_id: string | null
          id: string
          quantity: number
          sequence: number
          uom_id: string | null
        }
        Insert: {
          bom_id: string
          component_product_id: string
          component_variant_id?: string | null
          id?: string
          quantity?: number
          sequence?: number
          uom_id?: string | null
        }
        Update: {
          bom_id?: string
          component_product_id?: string
          component_variant_id?: string | null
          id?: string
          quantity?: number
          sequence?: number
          uom_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bom_lines_bom_id_fkey"
            columns: ["bom_id"]
            isOneToOne: false
            referencedRelation: "boms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "bom_lines_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "bom_lines_component_variant_id_fkey"
            columns: ["component_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "product_uom"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_operations: {
        Row: {
          bom_id: string
          duration_minutes: number
          id: string
          name: string
          sequence: number
          workcenter: string | null
        }
        Insert: {
          bom_id: string
          duration_minutes?: number
          id?: string
          name: string
          sequence?: number
          workcenter?: string | null
        }
        Update: {
          bom_id?: string
          duration_minutes?: number
          id?: string
          name?: string
          sequence?: number
          workcenter?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bom_operations_bom_id_fkey"
            columns: ["bom_id"]
            isOneToOne: false
            referencedRelation: "boms"
            referencedColumns: ["id"]
          },
        ]
      }
      boms: {
        Row: {
          active: boolean
          code: string | null
          created_at: string
          id: string
          product_id: string
          quantity: number
          type: Database["public"]["Enums"]["bom_type"]
          uom_id: string | null
          variant_id: string | null
        }
        Insert: {
          active?: boolean
          code?: string | null
          created_at?: string
          id?: string
          product_id: string
          quantity?: number
          type?: Database["public"]["Enums"]["bom_type"]
          uom_id?: string | null
          variant_id?: string | null
        }
        Update: {
          active?: boolean
          code?: string | null
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          type?: Database["public"]["Enums"]["bom_type"]
          uom_id?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boms_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "boms_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boms_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "boms_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "product_uom"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boms_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount: number
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          id: string
          kind: string
          notes: string | null
          partner_id: string | null
          payment_id: string | null
          picking_id: string | null
          reconciled_at: string | null
          reconciled_by: string | null
          reference: string | null
          route_id: string | null
          session_id: string
          user_id: string | null
        }
        Insert: {
          amount: number
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          notes?: string | null
          partner_id?: string | null
          payment_id?: string | null
          picking_id?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          reference?: string | null
          route_id?: string | null
          session_id: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          notes?: string | null
          partner_id?: string | null
          payment_id?: string | null
          picking_id?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          reference?: string | null
          route_id?: string | null
          session_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "customer_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_picking_id_fkey"
            columns: ["picking_id"]
            isOneToOne: false
            referencedRelation: "stock_pickings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_picking_id_fkey"
            columns: ["picking_id"]
            isOneToOne: false
            referencedRelation: "v_picking_exceptions"
            referencedColumns: ["picking_id"]
          },
          {
            foreignKeyName: "cash_movements_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "delivery_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_registers: {
        Row: {
          active: boolean
          created_at: string
          department_id: string | null
          driver_id: string | null
          id: string
          journal_id: string | null
          name: string
          store_id: string | null
          updated_at: string
          user_id: string | null
          warehouse_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          department_id?: string | null
          driver_id?: string | null
          id?: string
          journal_id?: string | null
          name: string
          store_id?: string | null
          updated_at?: string
          user_id?: string | null
          warehouse_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          department_id?: string | null
          driver_id?: string | null
          id?: string
          journal_id?: string | null
          name?: string
          store_id?: string | null
          updated_at?: string
          user_id?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_registers_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "account_journals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_registers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_registers_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["warehouse_id"]
          },
          {
            foreignKeyName: "cash_registers_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closing_balance_counted: number | null
          closing_balance_theoretical: number | null
          created_at: string
          difference: number | null
          handover_at: string | null
          handover_by: string | null
          handover_cash_amount: number | null
          handover_state: string
          id: string
          name: string
          notes: string | null
          opened_at: string
          opened_by: string | null
          opening_balance: number
          reconciled_at: string | null
          reconciled_by: string | null
          reconciliation_notes: string | null
          register_id: string
          route_id: string | null
          state: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closing_balance_counted?: number | null
          closing_balance_theoretical?: number | null
          created_at?: string
          difference?: number | null
          handover_at?: string | null
          handover_by?: string | null
          handover_cash_amount?: number | null
          handover_state?: string
          id?: string
          name: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_balance?: number
          reconciled_at?: string | null
          reconciled_by?: string | null
          reconciliation_notes?: string | null
          register_id: string
          route_id?: string | null
          state?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closing_balance_counted?: number | null
          closing_balance_theoretical?: number | null
          created_at?: string
          difference?: number | null
          handover_at?: string | null
          handover_by?: string | null
          handover_cash_amount?: number | null
          handover_state?: string
          id?: string
          name?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_balance?: number
          reconciled_at?: string | null
          reconciled_by?: string | null
          reconciliation_notes?: string | null
          register_id?: string
          route_id?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_register_id_fkey"
            columns: ["register_id"]
            isOneToOne: false
            referencedRelation: "cash_registers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "delivery_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channel_members: {
        Row: {
          channel_id: string
          joined_at: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          joined_at?: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          joined_at?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_channels: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_private: boolean
          kind: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_private?: boolean
          kind?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_private?: boolean
          kind?: string
          name?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          attachments: Json
          author_id: string
          body: string | null
          channel_id: string
          created_at: string
          id: string
          image_url: string | null
          mentions: string[]
        }
        Insert: {
          attachments?: Json
          author_id: string
          body?: string | null
          channel_id: string
          created_at?: string
          id?: string
          image_url?: string | null
          mentions?: string[]
        }
        Update: {
          attachments?: Json
          author_id?: string
          body?: string | null
          channel_id?: string
          created_at?: string
          id?: string
          image_url?: string | null
          mentions?: string[]
        }
        Relationships: []
      }
      companies: {
        Row: {
          created_at: string
          currency: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      cost_centers: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          parent_id: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_centers_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_payments: {
        Row: {
          amount: number
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string | null
          journal_id: string | null
          method_id: string | null
          name: string
          notes: string | null
          order_id: string | null
          partner_id: string | null
          payment_date: string
          reference: string | null
          refund_of: string | null
          schedule_id: string | null
          state: string
        }
        Insert: {
          amount: number
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          journal_id?: string | null
          method_id?: string | null
          name: string
          notes?: string | null
          order_id?: string | null
          partner_id?: string | null
          payment_date?: string
          reference?: string | null
          refund_of?: string | null
          schedule_id?: string | null
          state?: string
        }
        Update: {
          amount?: number
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          journal_id?: string | null
          method_id?: string | null
          name?: string
          notes?: string | null
          order_id?: string | null
          partner_id?: string | null
          payment_date?: string
          reference?: string | null
          refund_of?: string | null
          schedule_id?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_payments_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_payments_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "account_journals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_payments_method_id_fkey"
            columns: ["method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "customer_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_payments_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_payments_refund_of_fkey"
            columns: ["refund_of"]
            isOneToOne: false
            referencedRelation: "customer_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_payments_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "sale_payment_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_pickups: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          picked_up_at: string | null
          picked_up_by_doc: string | null
          picked_up_by_name: string | null
          picking_id: string | null
          sale_order_id: string
          scheduled_date: string | null
          status: string
          updated_at: string
          validated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          picked_up_at?: string | null
          picked_up_by_doc?: string | null
          picked_up_by_name?: string | null
          picking_id?: string | null
          sale_order_id: string
          scheduled_date?: string | null
          status?: string
          updated_at?: string
          validated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          picked_up_at?: string | null
          picked_up_by_doc?: string | null
          picked_up_by_name?: string | null
          picking_id?: string | null
          sale_order_id?: string
          scheduled_date?: string | null
          status?: string
          updated_at?: string
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_pickups_picking_id_fkey"
            columns: ["picking_id"]
            isOneToOne: false
            referencedRelation: "stock_pickings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_pickups_picking_id_fkey"
            columns: ["picking_id"]
            isOneToOne: false
            referencedRelation: "v_picking_exceptions"
            referencedColumns: ["picking_id"]
          },
          {
            foreignKeyName: "customer_pickups_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "customer_pickups_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_carriers: {
        Row: {
          active: boolean
          contact: string | null
          created_at: string
          id: string
          name: string
          phone: string | null
          stock_location_id: string | null
          tracking_url_template: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          contact?: string | null
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          stock_location_id?: string | null
          tracking_url_template?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          contact?: string | null
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          stock_location_id?: string | null
          tracking_url_template?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_carriers_stock_location_id_fkey"
            columns: ["stock_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_region_rules: {
        Row: {
          active: boolean
          country: string
          created_at: string
          id: string
          price: number
          region: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          country?: string
          created_at?: string
          id?: string
          price?: number
          region: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          country?: string
          created_at?: string
          id?: string
          price?: number
          region?: string
          updated_at?: string
        }
        Relationships: []
      }
      delivery_route_cash_closure: {
        Row: {
          actual_cash: number
          actual_mbway: number
          actual_other: number
          actual_transfer: number
          cash_register_id: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          expected_cash: number
          expected_mbway: number
          expected_other: number
          expected_transfer: number
          id: string
          notes: string | null
          reconciled_at: string | null
          reconciled_by: string | null
          route_id: string
          updated_at: string
          variance: number | null
        }
        Insert: {
          actual_cash?: number
          actual_mbway?: number
          actual_other?: number
          actual_transfer?: number
          cash_register_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          expected_cash?: number
          expected_mbway?: number
          expected_other?: number
          expected_transfer?: number
          id?: string
          notes?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          route_id: string
          updated_at?: string
          variance?: number | null
        }
        Update: {
          actual_cash?: number
          actual_mbway?: number
          actual_other?: number
          actual_transfer?: number
          cash_register_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          expected_cash?: number
          expected_mbway?: number
          expected_other?: number
          expected_transfer?: number
          id?: string
          notes?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          route_id?: string
          updated_at?: string
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_route_cash_closure_cash_register_id_fkey"
            columns: ["cash_register_id"]
            isOneToOne: false
            referencedRelation: "cash_registers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_route_cash_closure_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: true
            referencedRelation: "delivery_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_route_orders: {
        Row: {
          created_at: string
          delivered_at: string | null
          failed_reason: string | null
          id: string
          loaded_at: string | null
          returned_at: string | null
          route_id: string
          schedule_id: string
          sequence: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          failed_reason?: string | null
          id?: string
          loaded_at?: string | null
          returned_at?: string | null
          route_id: string
          schedule_id: string
          sequence?: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          failed_reason?: string | null
          id?: string
          loaded_at?: string | null
          returned_at?: string | null
          route_id?: string
          schedule_id?: string
          sequence?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_route_orders_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "delivery_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_route_orders_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "delivery_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_route_templates: {
        Row: {
          active: boolean
          created_at: string
          default_driver_id: string | null
          default_vehicle_id: string | null
          id: string
          max_assembly_minutes: number | null
          max_deliveries: number | null
          max_volume_m3: number | null
          max_weight_kg: number | null
          name: string
          route_type: string
          slot_end: string | null
          slot_start: string | null
          updated_at: string
          weekday: number
          zone_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          default_driver_id?: string | null
          default_vehicle_id?: string | null
          id?: string
          max_assembly_minutes?: number | null
          max_deliveries?: number | null
          max_volume_m3?: number | null
          max_weight_kg?: number | null
          name: string
          route_type?: string
          slot_end?: string | null
          slot_start?: string | null
          updated_at?: string
          weekday: number
          zone_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          default_driver_id?: string | null
          default_vehicle_id?: string | null
          id?: string
          max_assembly_minutes?: number | null
          max_deliveries?: number | null
          max_volume_m3?: number | null
          max_weight_kg?: number | null
          name?: string
          route_type?: string
          slot_end?: string | null
          slot_start?: string | null
          updated_at?: string
          weekday?: number
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_route_templates_default_driver_id_fkey"
            columns: ["default_driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_route_templates_default_vehicle_id_fkey"
            columns: ["default_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_route_templates_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "delivery_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_routes: {
        Row: {
          cap_assembly_minutes: number | null
          cap_deliveries: number | null
          cap_volume_m3: number | null
          cap_weight_kg: number | null
          capacity_status: string
          created_at: string
          current_assembly_minutes: number
          current_deliveries: number
          current_volume_m3: number
          current_weight_kg: number
          dock_id: string | null
          driver_id: string | null
          id: string
          max_assembly_minutes: number
          max_deliveries: number
          notes: string | null
          overridden_by: string | null
          override_reason: string | null
          requires_load_verification: boolean
          route_date: string
          route_type: string
          state: string
          template_id: string | null
          updated_at: string
          vehicle_id: string | null
          zone_id: string
        }
        Insert: {
          cap_assembly_minutes?: number | null
          cap_deliveries?: number | null
          cap_volume_m3?: number | null
          cap_weight_kg?: number | null
          capacity_status?: string
          created_at?: string
          current_assembly_minutes?: number
          current_deliveries?: number
          current_volume_m3?: number
          current_weight_kg?: number
          dock_id?: string | null
          driver_id?: string | null
          id?: string
          max_assembly_minutes?: number
          max_deliveries?: number
          notes?: string | null
          overridden_by?: string | null
          override_reason?: string | null
          requires_load_verification?: boolean
          route_date: string
          route_type?: string
          state?: string
          template_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
          zone_id: string
        }
        Update: {
          cap_assembly_minutes?: number | null
          cap_deliveries?: number | null
          cap_volume_m3?: number | null
          cap_weight_kg?: number | null
          capacity_status?: string
          created_at?: string
          current_assembly_minutes?: number
          current_deliveries?: number
          current_volume_m3?: number
          current_weight_kg?: number
          dock_id?: string | null
          driver_id?: string | null
          id?: string
          max_assembly_minutes?: number
          max_deliveries?: number
          notes?: string | null
          overridden_by?: string | null
          override_reason?: string | null
          requires_load_verification?: boolean
          route_date?: string
          route_type?: string
          state?: string
          template_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_routes_dock_fk"
            columns: ["dock_id"]
            isOneToOne: false
            referencedRelation: "loading_docks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_routes_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_routes_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "delivery_route_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_routes_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_routes_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "delivery_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_schedules: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          carrier_id: string | null
          created_at: string
          created_by: string | null
          delivery_address_id: string | null
          dock_id: string | null
          fulfillment_type: string | null
          id: string
          lane_id: string | null
          notes: string | null
          partner_id: string | null
          physical_state: string
          route_id: string | null
          sale_order_id: string
          scheduled_date: string
          slot_end: string | null
          slot_start: string | null
          status: string
          updated_at: string
          vehicle_id: string | null
          zone_id: string | null
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          carrier_id?: string | null
          created_at?: string
          created_by?: string | null
          delivery_address_id?: string | null
          dock_id?: string | null
          fulfillment_type?: string | null
          id?: string
          lane_id?: string | null
          notes?: string | null
          partner_id?: string | null
          physical_state?: string
          route_id?: string | null
          sale_order_id: string
          scheduled_date: string
          slot_end?: string | null
          slot_start?: string | null
          status?: string
          updated_at?: string
          vehicle_id?: string | null
          zone_id?: string | null
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          carrier_id?: string | null
          created_at?: string
          created_by?: string | null
          delivery_address_id?: string | null
          dock_id?: string | null
          fulfillment_type?: string | null
          id?: string
          lane_id?: string | null
          notes?: string | null
          partner_id?: string | null
          physical_state?: string
          route_id?: string | null
          sale_order_id?: string
          scheduled_date?: string
          slot_end?: string | null
          slot_start?: string | null
          status?: string
          updated_at?: string
          vehicle_id?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_schedules_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "delivery_carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_schedules_dock_id_fkey"
            columns: ["dock_id"]
            isOneToOne: false
            referencedRelation: "loading_docks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_schedules_lane_id_fkey"
            columns: ["lane_id"]
            isOneToOne: false
            referencedRelation: "loading_dock_lanes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_schedules_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_schedules_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "delivery_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_schedules_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "delivery_schedules_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_schedules_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_schedules_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "delivery_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_zip_rules: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string | null
          price: number
          updated_at: string
          zip_from: string
          zip_to: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string | null
          price?: number
          updated_at?: string
          zip_from: string
          zip_to: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string | null
          price?: number
          updated_at?: string
          zip_from?: string
          zip_to?: string
        }
        Relationships: []
      }
      delivery_zones: {
        Row: {
          active: boolean
          color: string | null
          created_at: string
          default_driver_id: string | null
          default_vehicle_id: string | null
          id: string
          max_assembly_minutes_per_day: number
          max_deliveries_per_day: number
          name: string
          notes: string | null
          updated_at: string
          weekdays: number[]
          zip_from: string
          zip_to: string
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          default_driver_id?: string | null
          default_vehicle_id?: string | null
          id?: string
          max_assembly_minutes_per_day?: number
          max_deliveries_per_day?: number
          name: string
          notes?: string | null
          updated_at?: string
          weekdays?: number[]
          zip_from: string
          zip_to: string
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          default_driver_id?: string | null
          default_vehicle_id?: string | null
          id?: string
          max_assembly_minutes_per_day?: number
          max_deliveries_per_day?: number
          name?: string
          notes?: string | null
          updated_at?: string
          weekdays?: number[]
          zip_from?: string
          zip_to?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_zones_default_driver_id_fkey"
            columns: ["default_driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_zones_default_vehicle_id_fkey"
            columns: ["default_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      dock_transfers: {
        Row: {
          created_at: string
          created_by: string | null
          dock_id: string | null
          id: string
          lane_id: string | null
          loaded_at: string | null
          moved_at: string | null
          picking_id: string | null
          route_id: string | null
          schedule_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dock_id?: string | null
          id?: string
          lane_id?: string | null
          loaded_at?: string | null
          moved_at?: string | null
          picking_id?: string | null
          route_id?: string | null
          schedule_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dock_id?: string | null
          id?: string
          lane_id?: string | null
          loaded_at?: string | null
          moved_at?: string | null
          picking_id?: string | null
          route_id?: string | null
          schedule_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dock_transfers_dock_id_fkey"
            columns: ["dock_id"]
            isOneToOne: false
            referencedRelation: "loading_docks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_transfers_lane_id_fkey"
            columns: ["lane_id"]
            isOneToOne: false
            referencedRelation: "loading_dock_lanes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_transfers_picking_id_fkey"
            columns: ["picking_id"]
            isOneToOne: false
            referencedRelation: "stock_pickings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_transfers_picking_id_fkey"
            columns: ["picking_id"]
            isOneToOne: false
            referencedRelation: "v_picking_exceptions"
            referencedColumns: ["picking_id"]
          },
          {
            foreignKeyName: "dock_transfers_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "delivery_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_transfers_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "delivery_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_health_check_log: {
        Row: {
          duration_ms: number | null
          findings: Json
          id: string
          notified: boolean
          p0_count: number
          p1_count: number
          p2_count: number
          p3_count: number
          run_at: string
          summary: Json
        }
        Insert: {
          duration_ms?: number | null
          findings: Json
          id?: string
          notified?: boolean
          p0_count?: number
          p1_count?: number
          p2_count?: number
          p3_count?: number
          run_at?: string
          summary: Json
        }
        Update: {
          duration_ms?: number | null
          findings?: Json
          id?: string
          notified?: boolean
          p0_count?: number
          p1_count?: number
          p2_count?: number
          p3_count?: number
          run_at?: string
          summary?: Json
        }
        Relationships: []
      }
      erp_remediation_log: {
        Row: {
          action: string
          actor: string | null
          after: Json | null
          applied: boolean
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          health_check_log_id: string | null
          id: string
          issue_type: string
          mode: string
          reason: string | null
          severity: string
        }
        Insert: {
          action: string
          actor?: string | null
          after?: Json | null
          applied?: boolean
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          health_check_log_id?: string | null
          id?: string
          issue_type: string
          mode: string
          reason?: string | null
          severity: string
        }
        Update: {
          action?: string
          actor?: string | null
          after?: Json | null
          applied?: boolean
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          health_check_log_id?: string | null
          id?: string
          issue_type?: string
          mode?: string
          reason?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_remediation_log_health_check_log_id_fkey"
            columns: ["health_check_log_id"]
            isOneToOne: false
            referencedRelation: "erp_health_check_log"
            referencedColumns: ["id"]
          },
        ]
      }
      group_permissions: {
        Row: {
          action: Database["public"]["Enums"]["permission_action"]
          entity: string
          group_id: string
          id: string
          module: Database["public"]["Enums"]["app_module"]
        }
        Insert: {
          action: Database["public"]["Enums"]["permission_action"]
          entity: string
          group_id: string
          id?: string
          module: Database["public"]["Enums"]["app_module"]
        }
        Update: {
          action?: Database["public"]["Enums"]["permission_action"]
          entity?: string
          group_id?: string
          id?: string
          module?: Database["public"]["Enums"]["app_module"]
        }
        Relationships: [
          {
            foreignKeyName: "group_permissions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          module: Database["public"]["Enums"]["app_module"]
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          module: Database["public"]["Enums"]["app_module"]
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          module?: Database["public"]["Enums"]["app_module"]
          name?: string
        }
        Relationships: []
      }
      hr_attendances: {
        Row: {
          check_in: string
          check_out: string | null
          created_at: string
          employee_id: string
          id: string
          notes: string | null
          worked_hours: number | null
        }
        Insert: {
          check_in?: string
          check_out?: string | null
          created_at?: string
          employee_id: string
          id?: string
          notes?: string | null
          worked_hours?: number | null
        }
        Update: {
          check_in?: string
          check_out?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          notes?: string | null
          worked_hours?: number | null
        }
        Relationships: []
      }
      hr_departments: {
        Row: {
          created_at: string
          id: string
          manager_id: string | null
          name: string
          parent_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          manager_id?: string | null
          name: string
          parent_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          manager_id?: string | null
          name?: string
          parent_id?: string | null
        }
        Relationships: []
      }
      hr_employees: {
        Row: {
          active: boolean
          avatar_url: string | null
          birth_date: string | null
          created_at: string
          department_id: string | null
          email: string | null
          full_name: string
          hire_date: string | null
          id: string
          job_title: string | null
          manager_id: string | null
          phone: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          birth_date?: string | null
          created_at?: string
          department_id?: string | null
          email?: string | null
          full_name: string
          hire_date?: string | null
          id?: string
          job_title?: string | null
          manager_id?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          birth_date?: string | null
          created_at?: string
          department_id?: string | null
          email?: string | null
          full_name?: string
          hire_date?: string | null
          id?: string
          job_title?: string | null
          manager_id?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      hr_leaves: {
        Row: {
          approver_id: string | null
          created_at: string
          employee_id: string
          end_date: string
          id: string
          reason: string | null
          start_date: string
          state: string
          type: string
        }
        Insert: {
          approver_id?: string | null
          created_at?: string
          employee_id: string
          end_date: string
          id?: string
          reason?: string | null
          start_date: string
          state?: string
          type?: string
        }
        Update: {
          approver_id?: string | null
          created_at?: string
          employee_id?: string
          end_date?: string
          id?: string
          reason?: string | null
          start_date?: string
          state?: string
          type?: string
        }
        Relationships: []
      }
      installed_modules: {
        Row: {
          installed: boolean
          installed_at: string
          module: Database["public"]["Enums"]["app_module"]
        }
        Insert: {
          installed?: boolean
          installed_at?: string
          module: Database["public"]["Enums"]["app_module"]
        }
        Update: {
          installed?: boolean
          installed_at?: string
          module?: Database["public"]["Enums"]["app_module"]
        }
        Relationships: []
      }
      inventory_adjustment_lines: {
        Row: {
          adjustment_id: string
          counted_qty: number
          difference: number | null
          id: string
          location_id: string
          lot_id: string | null
          product_id: string
          theoretical_qty: number
          variant_id: string | null
        }
        Insert: {
          adjustment_id: string
          counted_qty?: number
          difference?: number | null
          id?: string
          location_id: string
          lot_id?: string | null
          product_id: string
          theoretical_qty?: number
          variant_id?: string | null
        }
        Update: {
          adjustment_id?: string
          counted_qty?: number
          difference?: number | null
          id?: string
          location_id?: string
          lot_id?: string | null
          product_id?: string
          theoretical_qty?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_adjustment_lines_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "inventory_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_adjustment_lines_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_adjustment_lines_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "stock_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_adjustment_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_adjustment_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_adjustment_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_adjustment_lines_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_adjustments: {
        Row: {
          created_at: string
          created_by: string | null
          done_at: string | null
          id: string
          location_id: string | null
          name: string
          scheduled_at: string | null
          state: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          id?: string
          location_id?: string | null
          name: string
          scheduled_at?: string | null
          state?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          id?: string
          location_id?: string | null
          name?: string
          scheduled_at?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_adjustments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      loading_dock_lanes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          dock_id: string
          id: string
          notes: string | null
          stock_location_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          dock_id: string
          id?: string
          notes?: string | null
          stock_location_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          dock_id?: string
          id?: string
          notes?: string | null
          stock_location_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loading_dock_lanes_dock_id_fkey"
            columns: ["dock_id"]
            isOneToOne: false
            referencedRelation: "loading_docks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loading_dock_lanes_stock_location_id_fkey"
            columns: ["stock_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      loading_docks: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          notes: string | null
          stock_location_id: string | null
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          stock_location_id?: string | null
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          stock_location_id?: string | null
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loading_docks_stock_location_id_fkey"
            columns: ["stock_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loading_docks_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["warehouse_id"]
          },
          {
            foreignKeyName: "loading_docks_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturing_orders: {
        Row: {
          actual_end: string | null
          actual_start: string | null
          blocked_reason: string | null
          bom_id: string | null
          code: string
          created_at: string
          created_by: string | null
          due_date: string | null
          expected_finish_date: string | null
          id: string
          notes: string | null
          origin: Database["public"]["Enums"]["mo_origin"]
          partner_id: string | null
          planned_end: string | null
          planned_start: string | null
          priority: Database["public"]["Enums"]["mo_priority"]
          product_id: string
          qty: number
          responsible_id: string | null
          sale_order_id: string | null
          sale_order_line_id: string | null
          state: Database["public"]["Enums"]["mo_state"]
          uom_id: string | null
          updated_at: string
          variant_id: string | null
          warehouse_id: string | null
        }
        Insert: {
          actual_end?: string | null
          actual_start?: string | null
          blocked_reason?: string | null
          bom_id?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          expected_finish_date?: string | null
          id?: string
          notes?: string | null
          origin?: Database["public"]["Enums"]["mo_origin"]
          partner_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          priority?: Database["public"]["Enums"]["mo_priority"]
          product_id: string
          qty: number
          responsible_id?: string | null
          sale_order_id?: string | null
          sale_order_line_id?: string | null
          state?: Database["public"]["Enums"]["mo_state"]
          uom_id?: string | null
          updated_at?: string
          variant_id?: string | null
          warehouse_id?: string | null
        }
        Update: {
          actual_end?: string | null
          actual_start?: string | null
          blocked_reason?: string | null
          bom_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          expected_finish_date?: string | null
          id?: string
          notes?: string | null
          origin?: Database["public"]["Enums"]["mo_origin"]
          partner_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          priority?: Database["public"]["Enums"]["mo_priority"]
          product_id?: string
          qty?: number
          responsible_id?: string | null
          sale_order_id?: string | null
          sale_order_line_id?: string | null
          state?: Database["public"]["Enums"]["mo_state"]
          uom_id?: string | null
          updated_at?: string
          variant_id?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_orders_bom_id_fkey"
            columns: ["bom_id"]
            isOneToOne: false
            referencedRelation: "boms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_orders_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "manufacturing_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "manufacturing_orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "manufacturing_orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_orders_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_orders_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "product_uom"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_orders_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      mo_components: {
        Row: {
          created_at: string
          id: string
          mo_id: string
          product_id: string
          qty_available: number
          qty_consumed: number
          qty_required: number
          qty_reserved: number
          scrap_pct: number
          sequence: number
          status: Database["public"]["Enums"]["mo_component_status"]
          uom_id: string | null
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          mo_id: string
          product_id: string
          qty_available?: number
          qty_consumed?: number
          qty_required?: number
          qty_reserved?: number
          scrap_pct?: number
          sequence?: number
          status?: Database["public"]["Enums"]["mo_component_status"]
          uom_id?: string | null
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          mo_id?: string
          product_id?: string
          qty_available?: number
          qty_consumed?: number
          qty_required?: number
          qty_reserved?: number
          scrap_pct?: number
          sequence?: number
          status?: Database["public"]["Enums"]["mo_component_status"]
          uom_id?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mo_components_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mo_components_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "mo_components_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mo_components_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "mo_components_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "product_uom"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mo_components_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      mo_issues: {
        Row: {
          attachments: Json
          description: string | null
          id: string
          kind: Database["public"]["Enums"]["mo_issue_kind"]
          mo_id: string
          mo_operation_id: string | null
          reported_at: string
          reported_by: string | null
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          attachments?: Json
          description?: string | null
          id?: string
          kind: Database["public"]["Enums"]["mo_issue_kind"]
          mo_id: string
          mo_operation_id?: string | null
          reported_at?: string
          reported_by?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          attachments?: Json
          description?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["mo_issue_kind"]
          mo_id?: string
          mo_operation_id?: string | null
          reported_at?: string
          reported_by?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mo_issues_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mo_issues_mo_operation_id_fkey"
            columns: ["mo_operation_id"]
            isOneToOne: false
            referencedRelation: "mo_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      mo_operations: {
        Row: {
          created_at: string
          finished_at: string | null
          id: string
          is_qc: boolean
          is_rework: boolean
          mo_id: string
          name: string
          operator_id: string | null
          planned_minutes: number
          qty_done: number
          qty_scrap: number
          sequence: number
          started_at: string | null
          state: Database["public"]["Enums"]["mo_op_state"]
          workcenter: string | null
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          id?: string
          is_qc?: boolean
          is_rework?: boolean
          mo_id: string
          name: string
          operator_id?: string | null
          planned_minutes?: number
          qty_done?: number
          qty_scrap?: number
          sequence?: number
          started_at?: string | null
          state?: Database["public"]["Enums"]["mo_op_state"]
          workcenter?: string | null
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          id?: string
          is_qc?: boolean
          is_rework?: boolean
          mo_id?: string
          name?: string
          operator_id?: string | null
          planned_minutes?: number
          qty_done?: number
          qty_scrap?: number
          sequence?: number
          started_at?: string | null
          state?: Database["public"]["Enums"]["mo_op_state"]
          workcenter?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mo_operations_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      mo_quality_checks: {
        Row: {
          attachments: Json
          checked_at: string
          checked_by: string | null
          defects: string | null
          id: string
          mo_id: string
          mo_operation_id: string | null
          needs_rework: boolean
          notes: string | null
          result: Database["public"]["Enums"]["mo_qc_result"]
        }
        Insert: {
          attachments?: Json
          checked_at?: string
          checked_by?: string | null
          defects?: string | null
          id?: string
          mo_id: string
          mo_operation_id?: string | null
          needs_rework?: boolean
          notes?: string | null
          result: Database["public"]["Enums"]["mo_qc_result"]
        }
        Update: {
          attachments?: Json
          checked_at?: string
          checked_by?: string | null
          defects?: string | null
          id?: string
          mo_id?: string
          mo_operation_id?: string | null
          needs_rework?: boolean
          notes?: string | null
          result?: Database["public"]["Enums"]["mo_qc_result"]
        }
        Relationships: [
          {
            foreignKeyName: "mo_quality_checks_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mo_quality_checks_mo_operation_id_fkey"
            columns: ["mo_operation_id"]
            isOneToOne: false
            referencedRelation: "mo_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      mo_workorder_logs: {
        Row: {
          attachments: Json
          created_at: string
          finished_at: string | null
          id: string
          mo_id: string
          mo_operation_id: string
          notes: string | null
          operator_id: string | null
          qty_done: number
          qty_scrap: number
          started_at: string
        }
        Insert: {
          attachments?: Json
          created_at?: string
          finished_at?: string | null
          id?: string
          mo_id: string
          mo_operation_id: string
          notes?: string | null
          operator_id?: string | null
          qty_done?: number
          qty_scrap?: number
          started_at?: string
        }
        Update: {
          attachments?: Json
          created_at?: string
          finished_at?: string | null
          id?: string
          mo_id?: string
          mo_operation_id?: string
          notes?: string | null
          operator_id?: string | null
          qty_done?: number
          qty_scrap?: number
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mo_workorder_logs_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mo_workorder_logs_mo_operation_id_fkey"
            columns: ["mo_operation_id"]
            isOneToOne: false
            referencedRelation: "mo_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      module_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json
          processed: boolean
          source_module: Database["public"]["Enums"]["app_module"]
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          processed?: boolean
          source_module: Database["public"]["Enums"]["app_module"]
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean
          source_module?: Database["public"]["Enums"]["app_module"]
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          link: string | null
          module: Database["public"]["Enums"]["app_module"]
          payload: Json | null
          priority: string
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link?: string | null
          module: Database["public"]["Enums"]["app_module"]
          payload?: Json | null
          priority?: string
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link?: string | null
          module?: Database["public"]["Enums"]["app_module"]
          payload?: Json | null
          priority?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      number_sequences: {
        Row: {
          code: string
          next_number: number
          padding: number
          prefix: string
        }
        Insert: {
          code: string
          next_number?: number
          padding?: number
          prefix: string
        }
        Update: {
          code?: string
          next_number?: number
          padding?: number
          prefix?: string
        }
        Relationships: []
      }
      package_damage_report: {
        Row: {
          condition: string
          id: string
          reason: string | null
          reported_at: string
          reported_by: string | null
          route_id: string | null
          route_order_id: string | null
          stock_package_id: string
        }
        Insert: {
          condition: string
          id?: string
          reason?: string | null
          reported_at?: string
          reported_by?: string | null
          route_id?: string | null
          route_order_id?: string | null
          stock_package_id: string
        }
        Update: {
          condition?: string
          id?: string
          reason?: string | null
          reported_at?: string
          reported_by?: string | null
          route_id?: string | null
          route_order_id?: string | null
          stock_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_damage_report_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "delivery_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_damage_report_route_order_id_fkey"
            columns: ["route_order_id"]
            isOneToOne: false
            referencedRelation: "delivery_route_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_damage_report_stock_package_id_fkey"
            columns: ["stock_package_id"]
            isOneToOne: false
            referencedRelation: "stock_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_damage_reports: {
        Row: {
          created_at: string
          damage_type: string | null
          delivery_schedule_id: string | null
          description: string | null
          id: string
          photos: Json | null
          reported_by: string | null
          route_id: string | null
          sale_order_id: string | null
          sale_order_line_id: string | null
          status: Database["public"]["Enums"]["package_damage_status"]
          stock_package_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          damage_type?: string | null
          delivery_schedule_id?: string | null
          description?: string | null
          id?: string
          photos?: Json | null
          reported_by?: string | null
          route_id?: string | null
          sale_order_id?: string | null
          sale_order_line_id?: string | null
          status?: Database["public"]["Enums"]["package_damage_status"]
          stock_package_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          damage_type?: string | null
          delivery_schedule_id?: string | null
          description?: string | null
          id?: string
          photos?: Json | null
          reported_by?: string | null
          route_id?: string | null
          sale_order_id?: string | null
          sale_order_line_id?: string | null
          status?: Database["public"]["Enums"]["package_damage_status"]
          stock_package_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_damage_reports_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "package_damage_reports_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_damage_reports_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_damage_reports_stock_package_id_fkey"
            columns: ["stock_package_id"]
            isOneToOne: false
            referencedRelation: "stock_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          active: boolean
          city: string | null
          company_id: string | null
          country: string | null
          created_at: string
          email: string | null
          id: string
          is_customer: boolean
          is_supplier: boolean
          kind: Database["public"]["Enums"]["partner_kind"]
          name: string
          notes: string | null
          phone: string | null
          state: string | null
          street: string | null
          tax_id: string | null
          updated_at: string
          zip: string | null
        }
        Insert: {
          active?: boolean
          city?: string | null
          company_id?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_customer?: boolean
          is_supplier?: boolean
          kind?: Database["public"]["Enums"]["partner_kind"]
          name: string
          notes?: string | null
          phone?: string | null
          state?: string | null
          street?: string | null
          tax_id?: string | null
          updated_at?: string
          zip?: string | null
        }
        Update: {
          active?: boolean
          city?: string | null
          company_id?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_customer?: boolean
          is_supplier?: boolean
          kind?: Database["public"]["Enums"]["partner_kind"]
          name?: string
          notes?: string | null
          phone?: string | null
          state?: string | null
          street?: string | null
          tax_id?: string | null
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partners_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          active: boolean
          code: string
          confirmation_mode: string
          created_at: string
          default_journal_id: string | null
          feeds_cash_session: boolean
          id: string
          name: string
          requires_reference: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          confirmation_mode?: string
          created_at?: string
          default_journal_id?: string | null
          feeds_cash_session?: boolean
          id?: string
          name: string
          requires_reference?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          confirmation_mode?: string
          created_at?: string
          default_journal_id?: string | null
          feeds_cash_session?: boolean
          id?: string
          name?: string
          requires_reference?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_default_journal_id_fkey"
            columns: ["default_journal_id"]
            isOneToOne: false
            referencedRelation: "account_journals"
            referencedColumns: ["id"]
          },
        ]
      }
      pricelist_items: {
        Row: {
          category_id: string | null
          discount_pct: number | null
          fixed_price: number | null
          id: string
          min_qty: number
          pricelist_id: string
          product_id: string | null
        }
        Insert: {
          category_id?: string | null
          discount_pct?: number | null
          fixed_price?: number | null
          id?: string
          min_qty?: number
          pricelist_id: string
          product_id?: string | null
        }
        Update: {
          category_id?: string | null
          discount_pct?: number | null
          fixed_price?: number | null
          id?: string
          min_qty?: number
          pricelist_id?: string
          product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pricelist_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricelist_items_pricelist_id_fkey"
            columns: ["pricelist_id"]
            isOneToOne: false
            referencedRelation: "pricelists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricelist_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "pricelist_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricelist_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
        ]
      }
      pricelists: {
        Row: {
          active: boolean
          created_at: string
          currency: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          currency?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          currency?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      product_attribute_values: {
        Row: {
          attribute_id: string
          color: string | null
          id: string
          name: string
        }
        Insert: {
          attribute_id: string
          color?: string | null
          id?: string
          name: string
        }
        Update: {
          attribute_id?: string
          color?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_attribute_values_attribute_id_fkey"
            columns: ["attribute_id"]
            isOneToOne: false
            referencedRelation: "product_attributes"
            referencedColumns: ["id"]
          },
        ]
      }
      product_attributes: {
        Row: {
          display_type: string
          id: string
          name: string
        }
        Insert: {
          display_type?: string
          id?: string
          name: string
        }
        Update: {
          display_type?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      product_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_id: string | null
          removal_strategy: Database["public"]["Enums"]["removal_strategy"]
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          removal_strategy?: Database["public"]["Enums"]["removal_strategy"]
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          removal_strategy?: Database["public"]["Enums"]["removal_strategy"]
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      product_package_templates: {
        Row: {
          active: boolean
          barcode_pattern: string | null
          created_at: string
          default_assembly_minutes: number | null
          default_height_cm: number | null
          default_length_cm: number | null
          default_volume_m3: number | null
          default_weight_kg: number | null
          default_width_cm: number | null
          description: string | null
          fragile: boolean
          id: string
          is_required: boolean
          name: string
          package_group: string | null
          package_sequence: number
          package_total: number
          product_id: string
          requires_assembly: boolean
          requires_flat_transport: boolean
          stackable: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          barcode_pattern?: string | null
          created_at?: string
          default_assembly_minutes?: number | null
          default_height_cm?: number | null
          default_length_cm?: number | null
          default_volume_m3?: number | null
          default_weight_kg?: number | null
          default_width_cm?: number | null
          description?: string | null
          fragile?: boolean
          id?: string
          is_required?: boolean
          name: string
          package_group?: string | null
          package_sequence: number
          package_total: number
          product_id: string
          requires_assembly?: boolean
          requires_flat_transport?: boolean
          stackable?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          barcode_pattern?: string | null
          created_at?: string
          default_assembly_minutes?: number | null
          default_height_cm?: number | null
          default_length_cm?: number | null
          default_volume_m3?: number | null
          default_weight_kg?: number | null
          default_width_cm?: number | null
          description?: string | null
          fragile?: boolean
          id?: string
          is_required?: boolean
          name?: string
          package_group?: string | null
          package_sequence?: number
          package_total?: number
          product_id?: string
          requires_assembly?: boolean
          requires_flat_transport?: boolean
          stackable?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_package_templates_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_package_templates_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_package_templates_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_packages: {
        Row: {
          barcode: string | null
          created_at: string
          id: string
          label: string
          notes: string | null
          product_id: string
          sequence: number
          weight_kg: number | null
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          id?: string
          label: string
          notes?: string | null
          product_id: string
          sequence?: number
          weight_kg?: number | null
        }
        Update: {
          barcode?: string | null
          created_at?: string
          id?: string
          label?: string
          notes?: string | null
          product_id?: string
          sequence?: number
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_packages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_packages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_packages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_suppliers: {
        Row: {
          id: string
          lead_time_days: number
          min_qty: number
          partner_id: string
          price: number
          priority: number
          product_id: string
          supplier_sku: string | null
        }
        Insert: {
          id?: string
          lead_time_days?: number
          min_qty?: number
          partner_id: string
          price?: number
          priority?: number
          product_id: string
          supplier_sku?: string | null
        }
        Update: {
          id?: string
          lead_time_days?: number
          min_qty?: number
          partner_id?: string
          price?: number
          priority?: number
          product_id?: string
          supplier_sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_suppliers_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_suppliers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_suppliers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_suppliers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_tag_rel: {
        Row: {
          product_id: string
          tag_id: string
        }
        Insert: {
          product_id: string
          tag_id: string
        }
        Update: {
          product_id?: string
          tag_id?: string
        }
        Relationships: []
      }
      product_tags: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      product_template_attribute_values: {
        Row: {
          id: string
          price_extra: number
          template_attribute_id: string
          value_id: string
        }
        Insert: {
          id?: string
          price_extra?: number
          template_attribute_id: string
          value_id: string
        }
        Update: {
          id?: string
          price_extra?: number
          template_attribute_id?: string
          value_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_template_attribute_values_template_attribute_id_fkey"
            columns: ["template_attribute_id"]
            isOneToOne: false
            referencedRelation: "product_template_attributes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_template_attribute_values_value_id_fkey"
            columns: ["value_id"]
            isOneToOne: false
            referencedRelation: "product_attribute_values"
            referencedColumns: ["id"]
          },
        ]
      }
      product_template_attributes: {
        Row: {
          attribute_id: string
          id: string
          product_id: string
        }
        Insert: {
          attribute_id: string
          id?: string
          product_id: string
        }
        Update: {
          attribute_id?: string
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_template_attributes_attribute_id_fkey"
            columns: ["attribute_id"]
            isOneToOne: false
            referencedRelation: "product_attributes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_template_attributes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_template_attributes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_template_attributes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_uom: {
        Row: {
          category: string
          code: string
          id: string
          name: string
          ratio: number
        }
        Insert: {
          category?: string
          code: string
          id?: string
          name: string
          ratio?: number
        }
        Update: {
          category?: string
          code?: string
          id?: string
          name?: string
          ratio?: number
        }
        Relationships: []
      }
      product_variant_values: {
        Row: {
          value_id: string
          variant_id: string
        }
        Insert: {
          value_id: string
          variant_id: string
        }
        Update: {
          value_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variant_values_value_id_fkey"
            columns: ["value_id"]
            isOneToOne: false
            referencedRelation: "product_attribute_values"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variant_values_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          active: boolean
          barcode: string | null
          created_at: string
          id: string
          image_url: string | null
          price_extra: number
          product_id: string
          sku: string | null
          weight: number | null
          woo_sync_status: string | null
          woo_variation_id: number | null
        }
        Insert: {
          active?: boolean
          barcode?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          price_extra?: number
          product_id: string
          sku?: string | null
          weight?: number | null
          woo_sync_status?: string | null
          woo_variation_id?: number | null
        }
        Update: {
          active?: boolean
          barcode?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          price_extra?: number
          product_id?: string
          sku?: string | null
          weight?: number | null
          woo_sync_status?: string | null
          woo_variation_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_woo_categories: {
        Row: {
          product_id: string
          woo_category_id: string
        }
        Insert: {
          product_id: string
          woo_category_id: string
        }
        Update: {
          product_id?: string
          woo_category_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          assembly_fee: number
          assembly_minutes: number
          auto_purchase: boolean
          barcode: string | null
          can_be_manufactured: boolean
          can_be_purchased: boolean
          can_be_sold: boolean
          category_id: string | null
          company_id: string | null
          created_at: string
          delivery_surcharge: number
          depth: number | null
          description: string | null
          gross_weight: number | null
          height: number | null
          id: string
          image_url: string | null
          internal_ref: string | null
          list_price: number
          max_stock: number
          mfg_lead_time_days: number
          min_stock: number
          name: string
          net_weight: number | null
          package_tracking_enabled: boolean
          product_kind: string | null
          published_woo: boolean
          purchase_description: string | null
          purchase_lead_time_days: number
          purchase_uom_id: string | null
          requires_bom: boolean
          sales_description: string | null
          short_description: string | null
          standard_cost: number
          tracking: Database["public"]["Enums"]["product_tracking"]
          type: Database["public"]["Enums"]["product_type"]
          uom_id: string | null
          updated_at: string
          volume: number | null
          volume_m3: number | null
          weight: number | null
          weight_kg: number | null
          width: number | null
          woo_last_sync_at: string | null
          woo_product_id: number | null
          woo_slug: string | null
          woo_status: string | null
          woo_sync_status: string | null
        }
        Insert: {
          active?: boolean
          assembly_fee?: number
          assembly_minutes?: number
          auto_purchase?: boolean
          barcode?: string | null
          can_be_manufactured?: boolean
          can_be_purchased?: boolean
          can_be_sold?: boolean
          category_id?: string | null
          company_id?: string | null
          created_at?: string
          delivery_surcharge?: number
          depth?: number | null
          description?: string | null
          gross_weight?: number | null
          height?: number | null
          id?: string
          image_url?: string | null
          internal_ref?: string | null
          list_price?: number
          max_stock?: number
          mfg_lead_time_days?: number
          min_stock?: number
          name: string
          net_weight?: number | null
          package_tracking_enabled?: boolean
          product_kind?: string | null
          published_woo?: boolean
          purchase_description?: string | null
          purchase_lead_time_days?: number
          purchase_uom_id?: string | null
          requires_bom?: boolean
          sales_description?: string | null
          short_description?: string | null
          standard_cost?: number
          tracking?: Database["public"]["Enums"]["product_tracking"]
          type?: Database["public"]["Enums"]["product_type"]
          uom_id?: string | null
          updated_at?: string
          volume?: number | null
          volume_m3?: number | null
          weight?: number | null
          weight_kg?: number | null
          width?: number | null
          woo_last_sync_at?: string | null
          woo_product_id?: number | null
          woo_slug?: string | null
          woo_status?: string | null
          woo_sync_status?: string | null
        }
        Update: {
          active?: boolean
          assembly_fee?: number
          assembly_minutes?: number
          auto_purchase?: boolean
          barcode?: string | null
          can_be_manufactured?: boolean
          can_be_purchased?: boolean
          can_be_sold?: boolean
          category_id?: string | null
          company_id?: string | null
          created_at?: string
          delivery_surcharge?: number
          depth?: number | null
          description?: string | null
          gross_weight?: number | null
          height?: number | null
          id?: string
          image_url?: string | null
          internal_ref?: string | null
          list_price?: number
          max_stock?: number
          mfg_lead_time_days?: number
          min_stock?: number
          name?: string
          net_weight?: number | null
          package_tracking_enabled?: boolean
          product_kind?: string | null
          published_woo?: boolean
          purchase_description?: string | null
          purchase_lead_time_days?: number
          purchase_uom_id?: string | null
          requires_bom?: boolean
          sales_description?: string | null
          short_description?: string | null
          standard_cost?: number
          tracking?: Database["public"]["Enums"]["product_tracking"]
          type?: Database["public"]["Enums"]["product_type"]
          uom_id?: string | null
          updated_at?: string
          volume?: number | null
          volume_m3?: number | null
          weight?: number | null
          weight_kg?: number | null
          width?: number | null
          woo_last_sync_at?: string | null
          woo_product_id?: number | null
          woo_slug?: string | null
          woo_status?: string | null
          woo_sync_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_purchase_uom_id_fkey"
            columns: ["purchase_uom_id"]
            isOneToOne: false
            referencedRelation: "product_uom"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "product_uom"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          avatar_url: string | null
          company_id: string | null
          created_at: string
          department: string | null
          email: string | null
          full_name: string | null
          id: string
          job_title: string | null
          language: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          job_title?: string | null
          language?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          job_title?: string | null
          language?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_needs: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          manufacturing_order_id: string | null
          needed_by: string | null
          notes: string | null
          origin_kind: Database["public"]["Enums"]["purchase_need_origin"]
          priority: number
          product_id: string
          purchase_order_id: string | null
          qty_needed: number
          sale_order_id: string | null
          state: Database["public"]["Enums"]["purchase_need_state"]
          suggested_partner_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          manufacturing_order_id?: string | null
          needed_by?: string | null
          notes?: string | null
          origin_kind: Database["public"]["Enums"]["purchase_need_origin"]
          priority?: number
          product_id: string
          purchase_order_id?: string | null
          qty_needed: number
          sale_order_id?: string | null
          state?: Database["public"]["Enums"]["purchase_need_state"]
          suggested_partner_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          manufacturing_order_id?: string | null
          needed_by?: string | null
          notes?: string | null
          origin_kind?: Database["public"]["Enums"]["purchase_need_origin"]
          priority?: number
          product_id?: string
          purchase_order_id?: string | null
          qty_needed?: number
          sale_order_id?: string | null
          state?: Database["public"]["Enums"]["purchase_need_state"]
          suggested_partner_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_needs_manufacturing_order_id_fkey"
            columns: ["manufacturing_order_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_needs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_needs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_needs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_needs_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_needs_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "purchase_needs_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_needs_suggested_partner_id_fkey"
            columns: ["suggested_partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_lines: {
        Row: {
          description: string | null
          discount_pct: number
          id: string
          order_id: string
          product_id: string
          quantity: number
          sequence: number
          source_sale_order_id: string | null
          subtotal: number
          tax_pct: number
          unit_price: number
          uom_id: string | null
          variant_id: string | null
        }
        Insert: {
          description?: string | null
          discount_pct?: number
          id?: string
          order_id: string
          product_id: string
          quantity?: number
          sequence?: number
          source_sale_order_id?: string | null
          subtotal?: number
          tax_pct?: number
          unit_price?: number
          uom_id?: string | null
          variant_id?: string | null
        }
        Update: {
          description?: string | null
          discount_pct?: number
          id?: string
          order_id?: string
          product_id?: string
          quantity?: number
          sequence?: number
          source_sale_order_id?: string | null
          subtotal?: number
          tax_pct?: number
          unit_price?: number
          uom_id?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_order_lines_source_sale_order_id_fkey"
            columns: ["source_sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "purchase_order_lines_source_sale_order_id_fkey"
            columns: ["source_sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "product_uom"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_origins: {
        Row: {
          created_at: string
          po_id: string
          sale_order_id: string
        }
        Insert: {
          created_at?: string
          po_id: string
          sale_order_id: string
        }
        Update: {
          created_at?: string
          po_id?: string
          sale_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_origins_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_origins_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "purchase_order_origins_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          amount_tax: number
          amount_total: number
          amount_untaxed: number
          buyer_id: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          date_order: string
          expected_date: string | null
          id: string
          name: string
          notes: string | null
          origin: string | null
          partner_id: string
          state: Database["public"]["Enums"]["purchase_state"]
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          amount_tax?: number
          amount_total?: number
          amount_untaxed?: number
          buyer_id?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          date_order?: string
          expected_date?: string | null
          id?: string
          name: string
          notes?: string | null
          origin?: string | null
          partner_id: string
          state?: Database["public"]["Enums"]["purchase_state"]
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          amount_tax?: number
          amount_total?: number
          amount_untaxed?: number
          buyer_id?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          date_order?: string
          expected_date?: string | null
          id?: string
          name?: string
          notes?: string | null
          origin?: string | null
          partner_id?: string
          state?: Database["public"]["Enums"]["purchase_state"]
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["warehouse_id"]
          },
          {
            foreignKeyName: "purchase_orders_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      putaway_rules: {
        Row: {
          category_id: string | null
          destination_location_id: string
          id: string
          priority: number
          product_id: string | null
          warehouse_id: string
        }
        Insert: {
          category_id?: string | null
          destination_location_id: string
          id?: string
          priority?: number
          product_id?: string | null
          warehouse_id: string
        }
        Update: {
          category_id?: string | null
          destination_location_id?: string
          id?: string
          priority?: number
          product_id?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "putaway_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "putaway_rules_destination_location_id_fkey"
            columns: ["destination_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "putaway_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "putaway_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "putaway_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "putaway_rules_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["warehouse_id"]
          },
          {
            foreignKeyName: "putaway_rules_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      record_activities: {
        Row: {
          activity_type: string
          assigned_to: string | null
          created_at: string
          created_by: string | null
          done_at: string | null
          due_date: string | null
          id: string
          note: string | null
          record_id: string
          record_type: string
          state: string
          summary: string
        }
        Insert: {
          activity_type?: string
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          due_date?: string | null
          id?: string
          note?: string | null
          record_id: string
          record_type: string
          state?: string
          summary: string
        }
        Update: {
          activity_type?: string
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          due_date?: string | null
          id?: string
          note?: string | null
          record_id?: string
          record_type?: string
          state?: string
          summary?: string
        }
        Relationships: []
      }
      record_messages: {
        Row: {
          author_id: string | null
          body: string | null
          created_at: string
          id: string
          kind: string
          payload: Json | null
          record_id: string
          record_type: string
        }
        Insert: {
          author_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          payload?: Json | null
          record_id: string
          record_type: string
        }
        Update: {
          author_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          payload?: Json | null
          record_id?: string
          record_type?: string
        }
        Relationships: []
      }
      reordering_rules: {
        Row: {
          active: boolean
          check_interval_minutes: number
          created_at: string
          id: string
          last_run_at: string | null
          location_id: string | null
          max_qty: number
          min_qty: number
          multiple_qty: number
          next_run_at: string
          product_id: string
          variant_id: string | null
          warehouse_id: string
        }
        Insert: {
          active?: boolean
          check_interval_minutes?: number
          created_at?: string
          id?: string
          last_run_at?: string | null
          location_id?: string | null
          max_qty?: number
          min_qty?: number
          multiple_qty?: number
          next_run_at?: string
          product_id: string
          variant_id?: string | null
          warehouse_id: string
        }
        Update: {
          active?: boolean
          check_interval_minutes?: number
          created_at?: string
          id?: string
          last_run_at?: string | null
          location_id?: string | null
          max_qty?: number
          min_qty?: number
          multiple_qty?: number
          next_run_at?: string
          product_id?: string
          variant_id?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reordering_rules_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reordering_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reordering_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reordering_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reordering_rules_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reordering_rules_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["warehouse_id"]
          },
          {
            foreignKeyName: "reordering_rules_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_operational_plan_log: {
        Row: {
          duration_ms: number | null
          error: string | null
          id: string
          mode: string
          run_at: string
          sale_order_id: string
          summary: Json
        }
        Insert: {
          duration_ms?: number | null
          error?: string | null
          id?: string
          mode: string
          run_at?: string
          sale_order_id: string
          summary?: Json
        }
        Update: {
          duration_ms?: number | null
          error?: string | null
          id?: string
          mode?: string
          run_at?: string
          sale_order_id?: string
          summary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "sale_operational_plan_log_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "sale_operational_plan_log_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_order_line_supply_links: {
        Row: {
          created_at: string
          id: string
          inherited_from_line_id: string | null
          link_kind: Database["public"]["Enums"]["supply_link_kind"]
          manufacturing_order_id: string | null
          moved_at: string | null
          origin_line_id: string
          purchase_need_id: string | null
          purchase_order_line_id: string | null
          qty: number
          reservation_ref: string | null
          sale_order_line_id: string
          state: Database["public"]["Enums"]["supply_link_state"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          inherited_from_line_id?: string | null
          link_kind: Database["public"]["Enums"]["supply_link_kind"]
          manufacturing_order_id?: string | null
          moved_at?: string | null
          origin_line_id: string
          purchase_need_id?: string | null
          purchase_order_line_id?: string | null
          qty: number
          reservation_ref?: string | null
          sale_order_line_id: string
          state?: Database["public"]["Enums"]["supply_link_state"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          inherited_from_line_id?: string | null
          link_kind?: Database["public"]["Enums"]["supply_link_kind"]
          manufacturing_order_id?: string | null
          moved_at?: string | null
          origin_line_id?: string
          purchase_need_id?: string | null
          purchase_order_line_id?: string | null
          qty?: number
          reservation_ref?: string | null
          sale_order_line_id?: string
          state?: Database["public"]["Enums"]["supply_link_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_order_line_supply_links_inherited_from_line_id_fkey"
            columns: ["inherited_from_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_line_supply_links_manufacturing_order_id_fkey"
            columns: ["manufacturing_order_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_line_supply_links_origin_line_id_fkey"
            columns: ["origin_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_line_supply_links_purchase_need_id_fkey"
            columns: ["purchase_need_id"]
            isOneToOne: false
            referencedRelation: "purchase_needs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_line_supply_links_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_order_lines: {
        Row: {
          availability_source: string | null
          confidence_level: string | null
          description: string | null
          discount_pct: number
          expected_availability_date: string | null
          id: string
          last_planned_at: string | null
          line_kind: string
          manufacturing_status: Database["public"]["Enums"]["sol_mfg_status"]
          operational_status: string | null
          order_id: string
          parent_line_id: string | null
          product_id: string | null
          qty_delivered: number
          qty_reserved: number
          qty_split_out: number
          qty_to_manufacture: number
          qty_to_purchase: number
          quantity: number
          sequence: number
          subtotal: number
          tax_pct: number
          unit_price: number
          uom_id: string | null
          variant_id: string | null
        }
        Insert: {
          availability_source?: string | null
          confidence_level?: string | null
          description?: string | null
          discount_pct?: number
          expected_availability_date?: string | null
          id?: string
          last_planned_at?: string | null
          line_kind?: string
          manufacturing_status?: Database["public"]["Enums"]["sol_mfg_status"]
          operational_status?: string | null
          order_id: string
          parent_line_id?: string | null
          product_id?: string | null
          qty_delivered?: number
          qty_reserved?: number
          qty_split_out?: number
          qty_to_manufacture?: number
          qty_to_purchase?: number
          quantity?: number
          sequence?: number
          subtotal?: number
          tax_pct?: number
          unit_price?: number
          uom_id?: string | null
          variant_id?: string | null
        }
        Update: {
          availability_source?: string | null
          confidence_level?: string | null
          description?: string | null
          discount_pct?: number
          expected_availability_date?: string | null
          id?: string
          last_planned_at?: string | null
          line_kind?: string
          manufacturing_status?: Database["public"]["Enums"]["sol_mfg_status"]
          operational_status?: string | null
          order_id?: string
          parent_line_id?: string | null
          product_id?: string | null
          qty_delivered?: number
          qty_reserved?: number
          qty_split_out?: number
          qty_to_manufacture?: number
          qty_to_purchase?: number
          quantity?: number
          sequence?: number
          subtotal?: number
          tax_pct?: number
          unit_price?: number
          uom_id?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "sale_order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_lines_parent_line_id_fkey"
            columns: ["parent_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sale_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sale_order_lines_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "product_uom"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_lines_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_order_timeline: {
        Row: {
          created_by: string | null
          id: string
          occurred_at: string
          payload: Json
          ref: string | null
          sale_order_id: string
          sale_order_line_id: string | null
          source: string | null
          status: string
          step: string
        }
        Insert: {
          created_by?: string | null
          id?: string
          occurred_at?: string
          payload?: Json
          ref?: string | null
          sale_order_id: string
          sale_order_line_id?: string | null
          source?: string | null
          status?: string
          step: string
        }
        Update: {
          created_by?: string | null
          id?: string
          occurred_at?: string
          payload?: Json
          ref?: string | null
          sale_order_id?: string
          sale_order_line_id?: string | null
          source?: string | null
          status?: string
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_order_timeline_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "sale_order_timeline_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_timeline_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_orders: {
        Row: {
          amount_tax: number
          amount_total: number
          amount_untaxed: number
          cancelled_at: string | null
          closed_at: string | null
          commitment_date: string | null
          company_id: string | null
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          date_order: string
          deferred_reason: string | null
          delivery_mode: string
          delivery_region_rule_id: string | null
          delivery_zip_rule_id: string | null
          delivery_zone_label: string | null
          expected_ready_date: string | null
          fulfillment_status: string
          id: string
          include_assembly: boolean
          include_delivery: boolean
          invoice_date: string | null
          invoice_notes: string | null
          invoice_number: string | null
          invoice_status: string
          is_deferred: boolean
          last_planned_at: string | null
          name: string
          notes: string | null
          operational_status: string | null
          parent_sale_order_id: string | null
          partner_id: string
          payment_status: string
          pricelist_id: string | null
          root_sale_order_id: string | null
          salesperson_id: string | null
          split_at: string | null
          split_by: string | null
          state: Database["public"]["Enums"]["sale_state"]
          store_id: string | null
          updated_at: string
          validity_date: string | null
          warehouse_id: string | null
        }
        Insert: {
          amount_tax?: number
          amount_total?: number
          amount_untaxed?: number
          cancelled_at?: string | null
          closed_at?: string | null
          commitment_date?: string | null
          company_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          date_order?: string
          deferred_reason?: string | null
          delivery_mode?: string
          delivery_region_rule_id?: string | null
          delivery_zip_rule_id?: string | null
          delivery_zone_label?: string | null
          expected_ready_date?: string | null
          fulfillment_status?: string
          id?: string
          include_assembly?: boolean
          include_delivery?: boolean
          invoice_date?: string | null
          invoice_notes?: string | null
          invoice_number?: string | null
          invoice_status?: string
          is_deferred?: boolean
          last_planned_at?: string | null
          name: string
          notes?: string | null
          operational_status?: string | null
          parent_sale_order_id?: string | null
          partner_id: string
          payment_status?: string
          pricelist_id?: string | null
          root_sale_order_id?: string | null
          salesperson_id?: string | null
          split_at?: string | null
          split_by?: string | null
          state?: Database["public"]["Enums"]["sale_state"]
          store_id?: string | null
          updated_at?: string
          validity_date?: string | null
          warehouse_id?: string | null
        }
        Update: {
          amount_tax?: number
          amount_total?: number
          amount_untaxed?: number
          cancelled_at?: string | null
          closed_at?: string | null
          commitment_date?: string | null
          company_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          date_order?: string
          deferred_reason?: string | null
          delivery_mode?: string
          delivery_region_rule_id?: string | null
          delivery_zip_rule_id?: string | null
          delivery_zone_label?: string | null
          expected_ready_date?: string | null
          fulfillment_status?: string
          id?: string
          include_assembly?: boolean
          include_delivery?: boolean
          invoice_date?: string | null
          invoice_notes?: string | null
          invoice_number?: string | null
          invoice_status?: string
          is_deferred?: boolean
          last_planned_at?: string | null
          name?: string
          notes?: string | null
          operational_status?: string | null
          parent_sale_order_id?: string | null
          partner_id?: string
          payment_status?: string
          pricelist_id?: string | null
          root_sale_order_id?: string | null
          salesperson_id?: string | null
          split_at?: string | null
          split_by?: string | null
          state?: Database["public"]["Enums"]["sale_state"]
          store_id?: string | null
          updated_at?: string
          validity_date?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_delivery_region_rule_id_fkey"
            columns: ["delivery_region_rule_id"]
            isOneToOne: false
            referencedRelation: "delivery_region_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_delivery_zip_rule_id_fkey"
            columns: ["delivery_zip_rule_id"]
            isOneToOne: false
            referencedRelation: "delivery_zip_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_parent_sale_order_id_fkey"
            columns: ["parent_sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "sale_orders_parent_sale_order_id_fkey"
            columns: ["parent_sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_pricelist_id_fkey"
            columns: ["pricelist_id"]
            isOneToOne: false
            referencedRelation: "pricelists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_root_sale_order_id_fkey"
            columns: ["root_sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "sale_orders_root_sale_order_id_fkey"
            columns: ["root_sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["warehouse_id"]
          },
          {
            foreignKeyName: "sale_orders_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_payment_schedules: {
        Row: {
          amount: number
          created_at: string
          due_date: string | null
          due_days: number | null
          due_kind: string
          id: string
          label: string
          order_id: string
          paid_amount: number
          percent: number
          sequence: number
          state: string
        }
        Insert: {
          amount?: number
          created_at?: string
          due_date?: string | null
          due_days?: number | null
          due_kind?: string
          id?: string
          label?: string
          order_id: string
          paid_amount?: number
          percent?: number
          sequence?: number
          state?: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string | null
          due_days?: number | null
          due_kind?: string
          id?: string
          label?: string
          order_id?: string
          paid_amount?: number
          percent?: number
          sequence?: number
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_payment_schedules_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "sale_payment_schedules_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_split_payment_allocations: {
        Row: {
          amount_total_deferred: number
          amount_total_original: number
          amount_total_parent_after: number
          created_at: string
          created_by: string | null
          deferred_order_id: string
          delta_rounding: number
          id: string
          paid_so_far: number
          parent_order_id: string
          sinal_applied_to_deferred: number
        }
        Insert: {
          amount_total_deferred: number
          amount_total_original: number
          amount_total_parent_after: number
          created_at?: string
          created_by?: string | null
          deferred_order_id: string
          delta_rounding?: number
          id?: string
          paid_so_far?: number
          parent_order_id: string
          sinal_applied_to_deferred?: number
        }
        Update: {
          amount_total_deferred?: number
          amount_total_original?: number
          amount_total_parent_after?: number
          created_at?: string
          created_by?: string | null
          deferred_order_id?: string
          delta_rounding?: number
          id?: string
          paid_so_far?: number
          parent_order_id?: string
          sinal_applied_to_deferred?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_split_payment_allocations_deferred_order_id_fkey"
            columns: ["deferred_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "sale_split_payment_allocations_deferred_order_id_fkey"
            columns: ["deferred_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_split_payment_allocations_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "sale_split_payment_allocations_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_searches: {
        Row: {
          created_at: string
          entity: string
          filters: Json
          id: string
          is_default: boolean
          module: Database["public"]["Enums"]["app_module"]
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entity: string
          filters?: Json
          id?: string
          is_default?: boolean
          module: Database["public"]["Enums"]["app_module"]
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          entity?: string
          filters?: Json
          id?: string
          is_default?: boolean
          module?: Database["public"]["Enums"]["app_module"]
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      service_requests: {
        Row: {
          assigned_to: string | null
          closed_at: string | null
          created_at: string
          description: string | null
          first_response_at: string | null
          id: string
          name: string
          notified_at_risk_at: string | null
          notified_breached_at: string | null
          partner_id: string | null
          picking_id: string | null
          priority: string
          product_id: string | null
          reported_by: string | null
          resolution: string | null
          resolution_due_at: string | null
          resolved_at: string | null
          response_due_at: string | null
          route_id: string | null
          scheduled_for: string | null
          sla_extension_minutes: number
          sla_pause_reason: string | null
          sla_paused_at: string | null
          sla_paused_total_minutes: number
          sla_policy_id: string | null
          state: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string
          description?: string | null
          first_response_at?: string | null
          id?: string
          name: string
          notified_at_risk_at?: string | null
          notified_breached_at?: string | null
          partner_id?: string | null
          picking_id?: string | null
          priority?: string
          product_id?: string | null
          reported_by?: string | null
          resolution?: string | null
          resolution_due_at?: string | null
          resolved_at?: string | null
          response_due_at?: string | null
          route_id?: string | null
          scheduled_for?: string | null
          sla_extension_minutes?: number
          sla_pause_reason?: string | null
          sla_paused_at?: string | null
          sla_paused_total_minutes?: number
          sla_policy_id?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string
          description?: string | null
          first_response_at?: string | null
          id?: string
          name?: string
          notified_at_risk_at?: string | null
          notified_breached_at?: string | null
          partner_id?: string | null
          picking_id?: string | null
          priority?: string
          product_id?: string | null
          reported_by?: string | null
          resolution?: string | null
          resolution_due_at?: string | null
          resolved_at?: string | null
          response_due_at?: string | null
          route_id?: string | null
          scheduled_for?: string | null
          sla_extension_minutes?: number
          sla_pause_reason?: string | null
          sla_paused_at?: string | null
          sla_paused_total_minutes?: number
          sla_policy_id?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_requests_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_picking_id_fkey"
            columns: ["picking_id"]
            isOneToOne: false
            referencedRelation: "stock_pickings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_picking_id_fkey"
            columns: ["picking_id"]
            isOneToOne: false
            referencedRelation: "v_picking_exceptions"
            referencedColumns: ["picking_id"]
          },
          {
            foreignKeyName: "service_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "service_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "service_requests_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "delivery_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_sla_policy_id_fkey"
            columns: ["sla_policy_id"]
            isOneToOne: false
            referencedRelation: "service_sla_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      service_sla_exceptions: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          id: string
          minutes: number | null
          new_resolution_due_at: string | null
          new_response_due_at: string | null
          old_resolution_due_at: string | null
          old_response_due_at: string | null
          reason: string
          request_id: string
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          id?: string
          minutes?: number | null
          new_resolution_due_at?: string | null
          new_response_due_at?: string | null
          old_resolution_due_at?: string | null
          old_response_due_at?: string | null
          reason: string
          request_id: string
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          id?: string
          minutes?: number | null
          new_resolution_due_at?: string | null
          new_response_due_at?: string | null
          old_resolution_due_at?: string | null
          old_response_due_at?: string | null
          reason?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_sla_exceptions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      service_sla_policies: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          priority: string
          resolution_minutes: number
          response_minutes: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          priority: string
          resolution_minutes?: number
          response_minutes?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          priority?: string
          resolution_minutes?: number
          response_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      service_sla_priority_exceptions: {
        Row: {
          active: boolean
          created_at: string
          id: string
          priority: string
          reason: string | null
          resolution_minutes: number
          response_minutes: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          priority: string
          reason?: string | null
          resolution_minutes: number
          response_minutes: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          priority?: string
          reason?: string | null
          resolution_minutes?: number
          response_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      service_states: {
        Row: {
          color: string
          created_at: string
          id: string
          is_closed: boolean
          is_default: boolean
          key: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_closed?: boolean
          is_default?: boolean
          key: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_closed?: boolean
          is_default?: boolean
          key?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      stock_locations: {
        Row: {
          active: boolean
          barcode: string | null
          created_at: string
          full_path: string | null
          id: string
          is_bin: boolean
          is_zone: boolean
          name: string
          parent_id: string | null
          removal_strategy:
            | Database["public"]["Enums"]["removal_strategy"]
            | null
          return_kind: Database["public"]["Enums"]["return_kind"] | null
          type: Database["public"]["Enums"]["location_type"]
          warehouse_id: string | null
        }
        Insert: {
          active?: boolean
          barcode?: string | null
          created_at?: string
          full_path?: string | null
          id?: string
          is_bin?: boolean
          is_zone?: boolean
          name: string
          parent_id?: string | null
          removal_strategy?:
            | Database["public"]["Enums"]["removal_strategy"]
            | null
          return_kind?: Database["public"]["Enums"]["return_kind"] | null
          type?: Database["public"]["Enums"]["location_type"]
          warehouse_id?: string | null
        }
        Update: {
          active?: boolean
          barcode?: string | null
          created_at?: string
          full_path?: string | null
          id?: string
          is_bin?: boolean
          is_zone?: boolean
          name?: string
          parent_id?: string | null
          removal_strategy?:
            | Database["public"]["Enums"]["removal_strategy"]
            | null
          return_kind?: Database["public"]["Enums"]["return_kind"] | null
          type?: Database["public"]["Enums"]["location_type"]
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_locations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_locations_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["warehouse_id"]
          },
          {
            foreignKeyName: "stock_locations_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_lots: {
        Row: {
          created_at: string
          expiration_date: string | null
          id: string
          name: string
          product_id: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          expiration_date?: string | null
          id?: string
          name: string
          product_id: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          expiration_date?: string | null
          id?: string
          name?: string
          product_id?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_lots_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_moves: {
        Row: {
          created_at: string
          destination_location_id: string
          id: string
          lot_id: string | null
          package_id: string | null
          picking_id: string | null
          product_id: string
          quantity: number
          quantity_done: number
          reference: string | null
          reserved_quantity: number
          source_location_id: string
          state: Database["public"]["Enums"]["picking_state"]
          uom_id: string | null
          variant_id: string | null
          wave_id: string | null
        }
        Insert: {
          created_at?: string
          destination_location_id: string
          id?: string
          lot_id?: string | null
          package_id?: string | null
          picking_id?: string | null
          product_id: string
          quantity?: number
          quantity_done?: number
          reference?: string | null
          reserved_quantity?: number
          source_location_id: string
          state?: Database["public"]["Enums"]["picking_state"]
          uom_id?: string | null
          variant_id?: string | null
          wave_id?: string | null
        }
        Update: {
          created_at?: string
          destination_location_id?: string
          id?: string
          lot_id?: string | null
          package_id?: string | null
          picking_id?: string | null
          product_id?: string
          quantity?: number
          quantity_done?: number
          reference?: string | null
          reserved_quantity?: number
          source_location_id?: string
          state?: Database["public"]["Enums"]["picking_state"]
          uom_id?: string | null
          variant_id?: string | null
          wave_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_moves_destination_location_id_fkey"
            columns: ["destination_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "stock_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "product_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_picking_id_fkey"
            columns: ["picking_id"]
            isOneToOne: false
            referencedRelation: "stock_pickings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_picking_id_fkey"
            columns: ["picking_id"]
            isOneToOne: false
            referencedRelation: "v_picking_exceptions"
            referencedColumns: ["picking_id"]
          },
          {
            foreignKeyName: "stock_moves_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_moves_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_moves_source_location_id_fkey"
            columns: ["source_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "product_uom"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_wave_fk"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "stock_picking_waves"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_package_movements: {
        Row: {
          created_at: string
          from_bin_id: string | null
          from_location_id: string | null
          from_pallet_id: string | null
          id: string
          moved_by: string | null
          moved_qty: number
          reason: string | null
          stock_move_id: string | null
          stock_package_id: string
          to_bin_id: string | null
          to_location_id: string
          to_pallet_id: string | null
        }
        Insert: {
          created_at?: string
          from_bin_id?: string | null
          from_location_id?: string | null
          from_pallet_id?: string | null
          id?: string
          moved_by?: string | null
          moved_qty?: number
          reason?: string | null
          stock_move_id?: string | null
          stock_package_id: string
          to_bin_id?: string | null
          to_location_id: string
          to_pallet_id?: string | null
        }
        Update: {
          created_at?: string
          from_bin_id?: string | null
          from_location_id?: string | null
          from_pallet_id?: string | null
          id?: string
          moved_by?: string | null
          moved_qty?: number
          reason?: string | null
          stock_move_id?: string | null
          stock_package_id?: string
          to_bin_id?: string | null
          to_location_id?: string
          to_pallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_package_movements_from_bin_id_fkey"
            columns: ["from_bin_id"]
            isOneToOne: false
            referencedRelation: "warehouse_bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_package_movements_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_package_movements_from_pallet_id_fkey"
            columns: ["from_pallet_id"]
            isOneToOne: false
            referencedRelation: "warehouse_pallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_package_movements_stock_move_id_fkey"
            columns: ["stock_move_id"]
            isOneToOne: false
            referencedRelation: "stock_moves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_package_movements_stock_package_id_fkey"
            columns: ["stock_package_id"]
            isOneToOne: false
            referencedRelation: "stock_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_package_movements_to_bin_id_fkey"
            columns: ["to_bin_id"]
            isOneToOne: false
            referencedRelation: "warehouse_bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_package_movements_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_package_movements_to_pallet_id_fkey"
            columns: ["to_pallet_id"]
            isOneToOne: false
            referencedRelation: "warehouse_pallets"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_packages: {
        Row: {
          barcode: string | null
          condition: Database["public"]["Enums"]["package_condition"]
          created_at: string
          current_bin_id: string | null
          current_location_id: string
          current_pallet_id: string | null
          fragile: boolean
          generated_virtual_package: boolean
          height_cm: number | null
          id: string
          is_virtual: boolean
          length_cm: number | null
          manufacturing_order_id: string | null
          package_group: string | null
          package_ref: string | null
          package_sequence: number | null
          package_template_id: string | null
          package_total: number | null
          product_id: string
          purchase_order_id: string | null
          purchase_order_line_id: string | null
          qty: number
          requires_flat_transport: boolean
          sale_order_id: string | null
          sale_order_line_id: string | null
          stackable: boolean
          status: Database["public"]["Enums"]["package_status"]
          updated_at: string
          volume_m3: number | null
          weight_kg: number | null
          width_cm: number | null
        }
        Insert: {
          barcode?: string | null
          condition?: Database["public"]["Enums"]["package_condition"]
          created_at?: string
          current_bin_id?: string | null
          current_location_id: string
          current_pallet_id?: string | null
          fragile?: boolean
          generated_virtual_package?: boolean
          height_cm?: number | null
          id?: string
          is_virtual?: boolean
          length_cm?: number | null
          manufacturing_order_id?: string | null
          package_group?: string | null
          package_ref?: string | null
          package_sequence?: number | null
          package_template_id?: string | null
          package_total?: number | null
          product_id: string
          purchase_order_id?: string | null
          purchase_order_line_id?: string | null
          qty?: number
          requires_flat_transport?: boolean
          sale_order_id?: string | null
          sale_order_line_id?: string | null
          stackable?: boolean
          status?: Database["public"]["Enums"]["package_status"]
          updated_at?: string
          volume_m3?: number | null
          weight_kg?: number | null
          width_cm?: number | null
        }
        Update: {
          barcode?: string | null
          condition?: Database["public"]["Enums"]["package_condition"]
          created_at?: string
          current_bin_id?: string | null
          current_location_id?: string
          current_pallet_id?: string | null
          fragile?: boolean
          generated_virtual_package?: boolean
          height_cm?: number | null
          id?: string
          is_virtual?: boolean
          length_cm?: number | null
          manufacturing_order_id?: string | null
          package_group?: string | null
          package_ref?: string | null
          package_sequence?: number | null
          package_template_id?: string | null
          package_total?: number | null
          product_id?: string
          purchase_order_id?: string | null
          purchase_order_line_id?: string | null
          qty?: number
          requires_flat_transport?: boolean
          sale_order_id?: string | null
          sale_order_line_id?: string | null
          stackable?: boolean
          status?: Database["public"]["Enums"]["package_status"]
          updated_at?: string
          volume_m3?: number | null
          weight_kg?: number | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_packages_current_bin_id_fkey"
            columns: ["current_bin_id"]
            isOneToOne: false
            referencedRelation: "warehouse_bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_packages_current_location_id_fkey"
            columns: ["current_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_packages_current_pallet_id_fkey"
            columns: ["current_pallet_id"]
            isOneToOne: false
            referencedRelation: "warehouse_pallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_packages_manufacturing_order_id_fkey"
            columns: ["manufacturing_order_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_packages_package_template_id_fkey"
            columns: ["package_template_id"]
            isOneToOne: false
            referencedRelation: "product_package_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_packages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_packages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_packages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_packages_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_packages_purchase_order_line_id_fkey"
            columns: ["purchase_order_line_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_packages_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "stock_packages_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_packages_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_picking_batches: {
        Row: {
          created_at: string
          created_by: string | null
          delivery_date: string | null
          driver_id: string | null
          id: string
          name: string
          notes: string | null
          scheduled_at: string | null
          state: string
          updated_at: string
          user_id: string | null
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          driver_id?: string | null
          id?: string
          name: string
          notes?: string | null
          scheduled_at?: string | null
          state?: string
          updated_at?: string
          user_id?: string | null
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          driver_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          scheduled_at?: string | null
          state?: string
          updated_at?: string
          user_id?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_picking_batches_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_picking_waves: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          scheduled_at: string | null
          state: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          scheduled_at?: string | null
          state?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          scheduled_at?: string | null
          state?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      stock_pickings: {
        Row: {
          backorder_id: string | null
          batch_id: string | null
          carrier_id: string | null
          created_at: string
          created_by: string | null
          destination_location_id: string | null
          done_at: string | null
          id: string
          is_reschedule: boolean
          kind: Database["public"]["Enums"]["picking_kind"]
          name: string
          origin: string | null
          partner_id: string | null
          previous_picking_id: string | null
          reschedule_count: number
          reschedule_reason: string | null
          reservation_transfer_count: number
          route_id: string | null
          scheduled_at: string | null
          source_location_id: string | null
          state: Database["public"]["Enums"]["picking_state"]
          step_label: string | null
          tracking_ref: string | null
          updated_at: string
          vehicle_id: string | null
          warehouse_id: string | null
        }
        Insert: {
          backorder_id?: string | null
          batch_id?: string | null
          carrier_id?: string | null
          created_at?: string
          created_by?: string | null
          destination_location_id?: string | null
          done_at?: string | null
          id?: string
          is_reschedule?: boolean
          kind: Database["public"]["Enums"]["picking_kind"]
          name: string
          origin?: string | null
          partner_id?: string | null
          previous_picking_id?: string | null
          reschedule_count?: number
          reschedule_reason?: string | null
          reservation_transfer_count?: number
          route_id?: string | null
          scheduled_at?: string | null
          source_location_id?: string | null
          state?: Database["public"]["Enums"]["picking_state"]
          step_label?: string | null
          tracking_ref?: string | null
          updated_at?: string
          vehicle_id?: string | null
          warehouse_id?: string | null
        }
        Update: {
          backorder_id?: string | null
          batch_id?: string | null
          carrier_id?: string | null
          created_at?: string
          created_by?: string | null
          destination_location_id?: string | null
          done_at?: string | null
          id?: string
          is_reschedule?: boolean
          kind?: Database["public"]["Enums"]["picking_kind"]
          name?: string
          origin?: string | null
          partner_id?: string | null
          previous_picking_id?: string | null
          reschedule_count?: number
          reschedule_reason?: string | null
          reservation_transfer_count?: number
          route_id?: string | null
          scheduled_at?: string | null
          source_location_id?: string | null
          state?: Database["public"]["Enums"]["picking_state"]
          step_label?: string | null
          tracking_ref?: string | null
          updated_at?: string
          vehicle_id?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_pickings_backorder_id_fkey"
            columns: ["backorder_id"]
            isOneToOne: false
            referencedRelation: "stock_pickings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_pickings_backorder_id_fkey"
            columns: ["backorder_id"]
            isOneToOne: false
            referencedRelation: "v_picking_exceptions"
            referencedColumns: ["picking_id"]
          },
          {
            foreignKeyName: "stock_pickings_batch_fk"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "stock_picking_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_pickings_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "delivery_carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_pickings_destination_location_id_fkey"
            columns: ["destination_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_pickings_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_pickings_previous_picking_id_fkey"
            columns: ["previous_picking_id"]
            isOneToOne: false
            referencedRelation: "stock_pickings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_pickings_previous_picking_id_fkey"
            columns: ["previous_picking_id"]
            isOneToOne: false
            referencedRelation: "v_picking_exceptions"
            referencedColumns: ["picking_id"]
          },
          {
            foreignKeyName: "stock_pickings_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "delivery_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_pickings_source_location_id_fkey"
            columns: ["source_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_pickings_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_pickings_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["warehouse_id"]
          },
          {
            foreignKeyName: "stock_pickings_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_quants: {
        Row: {
          id: string
          location_id: string
          lot_id: string | null
          package_id: string | null
          product_id: string
          quantity: number
          reserved_quantity: number
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          id?: string
          location_id: string
          lot_id?: string | null
          package_id?: string | null
          product_id: string
          quantity?: number
          reserved_quantity?: number
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          id?: string
          location_id?: string
          lot_id?: string | null
          package_id?: string | null
          product_id?: string
          quantity?: number
          reserved_quantity?: number
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_quants_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_quants_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "stock_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_quants_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "product_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_quants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_quants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_quants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_quants_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_reservation_log: {
        Row: {
          action: string
          created_at: string
          id: string
          location_id: string | null
          lot_id: string | null
          notes: string | null
          origin_id: string | null
          origin_type: string
          product_id: string
          qty: number
          qty_after: number | null
          qty_before: number | null
          reserved_by: string | null
          variant_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          location_id?: string | null
          lot_id?: string | null
          notes?: string | null
          origin_id?: string | null
          origin_type: string
          product_id: string
          qty: number
          qty_after?: number | null
          qty_before?: number | null
          reserved_by?: string | null
          variant_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          location_id?: string | null
          lot_id?: string | null
          notes?: string | null
          origin_id?: string | null
          origin_type?: string
          product_id?: string
          qty?: number
          qty_after?: number | null
          qty_before?: number | null
          reserved_by?: string | null
          variant_id?: string | null
        }
        Relationships: []
      }
      store_members: {
        Row: {
          created_at: string
          role: string
          store_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role?: string
          store_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: string
          store_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_members_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          active: boolean
          city: string | null
          code: string
          country: string | null
          created_at: string
          email: string | null
          id: string
          manager_id: string | null
          name: string
          notes: string | null
          phone: string | null
          street: string | null
          tax_id: string | null
          updated_at: string
          warehouse_id: string | null
          zip: string | null
        }
        Insert: {
          active?: boolean
          city?: string | null
          code: string
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          manager_id?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          street?: string | null
          tax_id?: string | null
          updated_at?: string
          warehouse_id?: string | null
          zip?: string | null
        }
        Update: {
          active?: boolean
          city?: string | null
          code?: string
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          manager_id?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          street?: string | null
          tax_id?: string | null
          updated_at?: string
          warehouse_id?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stores_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stores_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["warehouse_id"]
          },
          {
            foreignKeyName: "stores_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_bills: {
        Row: {
          amount_paid: number
          amount_total: number
          bill_date: string
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          name: string
          notes: string | null
          partner_id: string
          purchase_order_id: string | null
          reference: string | null
          state: string
          updated_at: string
        }
        Insert: {
          amount_paid?: number
          amount_total?: number
          bill_date?: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          name: string
          notes?: string | null
          partner_id: string
          purchase_order_id?: string | null
          reference?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          amount_paid?: number
          amount_total?: number
          bill_date?: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          name?: string
          notes?: string | null
          partner_id?: string
          purchase_order_id?: string | null
          reference?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bills_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          amount: number
          bill_id: string | null
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          id: string
          journal_id: string | null
          method_id: string | null
          name: string
          notes: string | null
          partner_id: string | null
          payment_date: string
          reference: string | null
          state: string
        }
        Insert: {
          amount: number
          bill_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          journal_id?: string | null
          method_id?: string | null
          name: string
          notes?: string | null
          partner_id?: string | null
          payment_date?: string
          reference?: string | null
          state?: string
        }
        Update: {
          amount?: number
          bill_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          journal_id?: string | null
          method_id?: string | null
          name?: string
          notes?: string | null
          partner_id?: string | null
          payment_date?: string
          reference?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "account_journals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_method_id_fkey"
            columns: ["method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      user_filter_preferences: {
        Row: {
          created_at: string
          id: string
          storage_key: string
          updated_at: string
          user_id: string
          values: Json
        }
        Insert: {
          created_at?: string
          id?: string
          storage_key: string
          updated_at?: string
          user_id: string
          values?: Json
        }
        Update: {
          created_at?: string
          id?: string
          storage_key?: string
          updated_at?: string
          user_id?: string
          values?: Json
        }
        Relationships: []
      }
      user_groups: {
        Row: {
          group_id: string
          user_id: string
        }
        Insert: {
          group_id: string
          user_id: string
        }
        Update: {
          group_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_groups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_route_manifest: {
        Row: {
          assistance_case_id: string | null
          assistance_required: boolean
          created_at: string
          damaged: boolean
          fragile: boolean
          height_cm: number | null
          id: string
          length_cm: number | null
          loaded_at: string | null
          loaded_by: string | null
          package_group: string | null
          package_ref: string | null
          package_sequence: number | null
          package_total: number | null
          product_id: string | null
          qty_delivered: number
          qty_loaded: number
          qty_pending: number | null
          qty_returned: number
          requires_flat_transport: boolean
          return_condition: Database["public"]["Enums"]["return_kind"] | null
          return_reason: string | null
          route_id: string
          route_order_id: string | null
          sale_order_line_id: string | null
          schedule_id: string | null
          stackable: boolean
          stock_move_id: string | null
          stock_package_id: string | null
          stop_sequence: number | null
          updated_at: string
          vehicle_location_id: string | null
          verification_required: boolean
          verified_at: string | null
          verified_by: string | null
          volume_m3: number | null
          weight_kg: number | null
          width_cm: number | null
        }
        Insert: {
          assistance_case_id?: string | null
          assistance_required?: boolean
          created_at?: string
          damaged?: boolean
          fragile?: boolean
          height_cm?: number | null
          id?: string
          length_cm?: number | null
          loaded_at?: string | null
          loaded_by?: string | null
          package_group?: string | null
          package_ref?: string | null
          package_sequence?: number | null
          package_total?: number | null
          product_id?: string | null
          qty_delivered?: number
          qty_loaded?: number
          qty_pending?: number | null
          qty_returned?: number
          requires_flat_transport?: boolean
          return_condition?: Database["public"]["Enums"]["return_kind"] | null
          return_reason?: string | null
          route_id: string
          route_order_id?: string | null
          sale_order_line_id?: string | null
          schedule_id?: string | null
          stackable?: boolean
          stock_move_id?: string | null
          stock_package_id?: string | null
          stop_sequence?: number | null
          updated_at?: string
          vehicle_location_id?: string | null
          verification_required?: boolean
          verified_at?: string | null
          verified_by?: string | null
          volume_m3?: number | null
          weight_kg?: number | null
          width_cm?: number | null
        }
        Update: {
          assistance_case_id?: string | null
          assistance_required?: boolean
          created_at?: string
          damaged?: boolean
          fragile?: boolean
          height_cm?: number | null
          id?: string
          length_cm?: number | null
          loaded_at?: string | null
          loaded_by?: string | null
          package_group?: string | null
          package_ref?: string | null
          package_sequence?: number | null
          package_total?: number | null
          product_id?: string | null
          qty_delivered?: number
          qty_loaded?: number
          qty_pending?: number | null
          qty_returned?: number
          requires_flat_transport?: boolean
          return_condition?: Database["public"]["Enums"]["return_kind"] | null
          return_reason?: string | null
          route_id?: string
          route_order_id?: string | null
          sale_order_line_id?: string | null
          schedule_id?: string | null
          stackable?: boolean
          stock_move_id?: string | null
          stock_package_id?: string | null
          stop_sequence?: number | null
          updated_at?: string
          vehicle_location_id?: string | null
          verification_required?: boolean
          verified_at?: string | null
          verified_by?: string | null
          volume_m3?: number | null
          weight_kg?: number | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_route_manifest_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "delivery_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_route_order_id_fkey"
            columns: ["route_order_id"]
            isOneToOne: false
            referencedRelation: "delivery_route_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "delivery_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_stock_move_id_fkey"
            columns: ["stock_move_id"]
            isOneToOne: false
            referencedRelation: "stock_moves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_stock_package_id_fkey"
            columns: ["stock_package_id"]
            isOneToOne: false
            referencedRelation: "stock_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_vehicle_location_id_fkey"
            columns: ["vehicle_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          active: boolean
          assembly_minutes_capacity: number | null
          barcode: string | null
          cash_register_id: string | null
          created_at: string
          driver_id: string | null
          id: string
          license_plate: string | null
          max_assembly_minutes: number | null
          max_stops: number | null
          max_weight_kg: number | null
          name: string
          notes: string | null
          requires_load_verification: boolean
          stock_location_id: string | null
          supports_flat_transport: boolean
          updated_at: string
          usable_height_cm: number | null
          usable_length_cm: number | null
          usable_volume_m3: number | null
          usable_width_cm: number | null
          volume_m3: number | null
          weight_kg: number | null
        }
        Insert: {
          active?: boolean
          assembly_minutes_capacity?: number | null
          barcode?: string | null
          cash_register_id?: string | null
          created_at?: string
          driver_id?: string | null
          id?: string
          license_plate?: string | null
          max_assembly_minutes?: number | null
          max_stops?: number | null
          max_weight_kg?: number | null
          name: string
          notes?: string | null
          requires_load_verification?: boolean
          stock_location_id?: string | null
          supports_flat_transport?: boolean
          updated_at?: string
          usable_height_cm?: number | null
          usable_length_cm?: number | null
          usable_volume_m3?: number | null
          usable_width_cm?: number | null
          volume_m3?: number | null
          weight_kg?: number | null
        }
        Update: {
          active?: boolean
          assembly_minutes_capacity?: number | null
          barcode?: string | null
          cash_register_id?: string | null
          created_at?: string
          driver_id?: string | null
          id?: string
          license_plate?: string | null
          max_assembly_minutes?: number | null
          max_stops?: number | null
          max_weight_kg?: number | null
          name?: string
          notes?: string | null
          requires_load_verification?: boolean
          stock_location_id?: string | null
          supports_flat_transport?: boolean
          updated_at?: string
          usable_height_cm?: number | null
          usable_length_cm?: number | null
          usable_volume_m3?: number | null
          usable_width_cm?: number | null
          volume_m3?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_cash_register_id_fkey"
            columns: ["cash_register_id"]
            isOneToOne: false
            referencedRelation: "cash_registers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_stock_location_id_fkey"
            columns: ["stock_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_bins: {
        Row: {
          active: boolean
          barcode: string | null
          code: string
          created_at: string
          id: string
          level: string | null
          location_id: string
          position: string | null
          rack: string | null
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          active?: boolean
          barcode?: string | null
          code: string
          created_at?: string
          id?: string
          level?: string | null
          location_id: string
          position?: string | null
          rack?: string | null
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          active?: boolean
          barcode?: string | null
          code?: string
          created_at?: string
          id?: string
          level?: string | null
          location_id?: string
          position?: string | null
          rack?: string | null
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_bins_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_bins_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["warehouse_id"]
          },
          {
            foreignKeyName: "warehouse_bins_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_pallets: {
        Row: {
          barcode: string | null
          code: string
          created_at: string
          current_bin_id: string | null
          current_location_id: string
          id: string
          status: Database["public"]["Enums"]["pallet_status"]
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          barcode?: string | null
          code: string
          created_at?: string
          current_bin_id?: string | null
          current_location_id: string
          id?: string
          status?: Database["public"]["Enums"]["pallet_status"]
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          barcode?: string | null
          code?: string
          created_at?: string
          current_bin_id?: string | null
          current_location_id?: string
          id?: string
          status?: Database["public"]["Enums"]["pallet_status"]
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_pallets_current_bin_id_fkey"
            columns: ["current_bin_id"]
            isOneToOne: false
            referencedRelation: "warehouse_bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_pallets_current_location_id_fkey"
            columns: ["current_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_pallets_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["warehouse_id"]
          },
          {
            foreignKeyName: "warehouse_pallets_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          active: boolean
          address: string | null
          code: string
          company_id: string | null
          created_at: string
          delivery_steps: string
          id: string
          is_store: boolean
          name: string
          reception_steps: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          code: string
          company_id?: string | null
          created_at?: string
          delivery_steps?: string
          id?: string
          is_store?: boolean
          name: string
          reception_steps?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          code?: string
          company_id?: string | null
          created_at?: string
          delivery_steps?: string
          id?: string
          is_store?: boolean
          name?: string
          reception_steps?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      woo_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_id: string | null
          slug: string | null
          woo_id: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          slug?: string | null
          woo_id?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          slug?: string | null
          woo_id?: number | null
        }
        Relationships: []
      }
      woo_sync_log: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string
          error: string | null
          id: string
          status: string
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          error?: string | null
          id?: string
          status: string
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          error?: string | null
          id?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      product_stock_forecast: {
        Row: {
          available: number | null
          forecasted: number | null
          incoming: number | null
          on_hand: number | null
          outgoing: number | null
          product_id: string | null
          reserved: number | null
          sold_30d: number | null
          sold_90d: number | null
          warehouse_id: string | null
        }
        Relationships: []
      }
      sale_order_fulfillment: {
        Row: {
          order_id: string | null
          po_any_confirmed: boolean | null
          po_any_draft: boolean | null
          qty_done: number | null
          qty_incoming: number | null
          qty_reserved: number | null
          qty_total: number | null
          state: Database["public"]["Enums"]["sale_state"] | null
        }
        Relationships: []
      }
      v_manifest_by_line: {
        Row: {
          any_assistance: boolean | null
          any_damaged: boolean | null
          package_count: number | null
          pending_verification: boolean | null
          product_id: string | null
          qty_delivered: number | null
          qty_loaded: number | null
          qty_pending: number | null
          qty_returned: number | null
          route_id: string | null
          route_order_id: string | null
          sale_order_line_id: string | null
          schedule_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_route_manifest_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "delivery_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_route_order_id_fkey"
            columns: ["route_order_id"]
            isOneToOne: false
            referencedRelation: "delivery_route_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "delivery_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      v_package_backfill_preview: {
        Row: {
          divergence: boolean | null
          existing_packages: number | null
          has_real_template: boolean | null
          internal_ref: string | null
          is_multi_location: boolean | null
          location_id: string | null
          location_name: string | null
          lot_id: string | null
          note: string | null
          packages_previstos: number | null
          product_id: string | null
          product_name: string | null
          qty_in_stock: number | null
          risco: string | null
          source: string | null
          template_total: number | null
        }
        Relationships: []
      }
      v_picking_exceptions: {
        Row: {
          batch_id: string | null
          kind: Database["public"]["Enums"]["picking_kind"] | null
          name: string | null
          overdue: boolean | null
          partner_id: string | null
          picking_id: string | null
          previous_picking_id: string | null
          scheduled_at: string | null
          shortage_lines: number | null
          state: Database["public"]["Enums"]["picking_state"] | null
          step_label: string | null
          total_shortage: number | null
          waiting_previous: boolean | null
          warehouse_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_pickings_batch_fk"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "stock_picking_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_pickings_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_pickings_previous_picking_id_fkey"
            columns: ["previous_picking_id"]
            isOneToOne: false
            referencedRelation: "stock_pickings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_pickings_previous_picking_id_fkey"
            columns: ["previous_picking_id"]
            isOneToOne: false
            referencedRelation: "v_picking_exceptions"
            referencedColumns: ["picking_id"]
          },
          {
            foreignKeyName: "stock_pickings_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["warehouse_id"]
          },
          {
            foreignKeyName: "stock_pickings_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      v_product_stock_full: {
        Row: {
          available: number | null
          forecasted: number | null
          in_production: number | null
          incoming: number | null
          max_stock: number | null
          min_stock: number | null
          name: string | null
          on_hand: number | null
          outgoing: number | null
          product_id: string | null
          reserved: number | null
        }
        Relationships: []
      }
      v_quant_vs_package_diff: {
        Row: {
          difference: number | null
          expected_package_count: number | null
          location_id: string | null
          package_count: number | null
          package_damaged_count: number | null
          package_good_count: number | null
          package_missing_count: number | null
          package_quarantine_count: number | null
          product_id: string | null
          quant_qty: number | null
          status: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _m25_backfill_real_packages: { Args: never; Returns: Json }
      _m3_apply_vehicle_capacity: {
        Args: { _route_id: string }
        Returns: undefined
      }
      _m3_is_admin: { Args: never; Returns: boolean }
      _m3_is_logistics: { Args: never; Returns: boolean }
      _m3_log: {
        Args: { _payload: Json; _ref: string; _so: string; _step: string }
        Returns: undefined
      }
      _m4_make_move: {
        Args: {
          _dst: string
          _pkg: string
          _product: string
          _qty: number
          _ref: string
          _src: string
        }
        Returns: string
      }
      _m4_pick_lane: { Args: { _dock_id: string }; Returns: string }
      _m4_return_loc: { Args: { _kind: string }; Returns: string }
      _m5_carrier_loc: { Args: { _carrier_id: string }; Returns: string }
      _m5_customer_loc: { Args: never; Returns: string }
      _m5_pickup_loc: { Args: never; Returns: string }
      _m5_record_payment: {
        Args: { _payment: Json; _route: string; _schedule: string; _so: string }
        Returns: Json
      }
      _so_ensure_mo_for_line: {
        Args: { _line_id: string; _qty: number }
        Returns: string
      }
      _so_reserve_line: {
        Args: { _line_id: string; _qty: number }
        Returns: number
      }
      _so_split_finance: {
        Args: { _deferred: string; _parent: string }
        Returns: Json
      }
      _soss_inherited_qty: { Args: { _line_id: string }; Returns: number }
      _soss_record: {
        Args: {
          _kind: Database["public"]["Enums"]["supply_link_kind"]
          _line_id: string
          _mo_id: string
          _need_id: string
          _pol_id: string
          _qty: number
        }
        Returns: string
      }
      _test_phase10: { Args: never; Returns: Json }
      _test_phase11: { Args: never; Returns: Json }
      _test_phase12: { Args: never; Returns: Json }
      _test_phase13: { Args: never; Returns: Json }
      _test_phase14: { Args: never; Returns: Json }
      _test_phase15_2: { Args: never; Returns: Json }
      _test_phase15_2_m6: { Args: never; Returns: Json }
      _test_phase15_m3: { Args: never; Returns: Json }
      _test_phase15_m4: { Args: never; Returns: Json }
      _test_phase15_m5: { Args: never; Returns: Json }
      _test_phase3: { Args: never; Returns: Json }
      _test_phase4: { Args: never; Returns: Json }
      _test_phase5: { Args: never; Returns: Json }
      _test_phase6: { Args: never; Returns: Json }
      _test_phase7: { Args: never; Returns: Json }
      _test_phase8: { Args: never; Returns: Json }
      _test_phase9: { Args: never; Returns: Json }
      _wh_main_internal_loc: { Args: { _wh: string }; Returns: string }
      allocate_payment_to_schedules: {
        Args: { _so: string }
        Returns: undefined
      }
      apply_inventory_adjustment: { Args: { _adj: string }; Returns: undefined }
      assert_lines_have_variant: {
        Args: { _order: string; _table: string }
        Returns: undefined
      }
      assert_so_has_lines: { Args: { _order: string }; Returns: undefined }
      available_delivery_slots: {
        Args: { _from: string; _to: string; _zone_id: string }
        Returns: {
          remaining_assembly_minutes: number
          remaining_deliveries: number
          remaining_volume_m3: number
          remaining_weight_kg: number
          route_date: string
          route_id: string
          status: string
          vehicle_id: string
          zone_id: string
        }[]
      }
      bootstrap_carrier_location: {
        Args: { _carrier: string }
        Returns: string
      }
      bootstrap_vehicle_location: {
        Args: { _vehicle: string }
        Returns: string
      }
      bootstrap_warehouse_logistics_locations: {
        Args: { _wh: string }
        Returns: undefined
      }
      calc_delivery_price: {
        Args: { _order: string }
        Returns: {
          label: string
          price: number
        }[]
      }
      cancel_batch: { Args: { _batch: string }; Returns: undefined }
      cancel_mo: { Args: { _mo: string }; Returns: undefined }
      cancel_picking: {
        Args: { _cascade?: boolean; _picking: string }
        Returns: undefined
      }
      cancel_purchase_order: { Args: { _order: string }; Returns: undefined }
      cancel_sale_order: { Args: { _order: string }; Returns: undefined }
      cancel_wave: { Args: { _wave: string }; Returns: undefined }
      carrier_confirm_delivered: {
        Args: { _schedule_id: string }
        Returns: Json
      }
      carrier_mark_failed_or_returned: {
        Args: { _condition?: string; _reason: string; _schedule_id: string }
        Returns: Json
      }
      cash_movement_create: {
        Args: {
          _amount: number
          _kind: string
          _notes?: string
          _reference?: string
          _session_id: string
        }
        Returns: Json
      }
      cash_session_balance: { Args: { _session: string }; Returns: number }
      cash_session_summary: { Args: { _session: string }; Returns: Json }
      close_cash_session: {
        Args: { _counted: number; _session: string }
        Returns: undefined
      }
      close_mo: { Args: { _mo: string; _qty_produced?: number }; Returns: Json }
      confirm_pending_payment: {
        Args: { _payment: string }
        Returns: undefined
      }
      confirm_purchase_order: { Args: { _order: string }; Returns: undefined }
      confirm_sale_order: { Args: { _order: string }; Returns: undefined }
      create_batch: { Args: { _pickings: string[] }; Returns: string }
      create_customer_pickup: {
        Args: { _sale_order_id: string; _scheduled_date?: string }
        Returns: Json
      }
      create_internal_transfer: {
        Args: {
          _destination: string
          _lines: Json
          _partner?: string
          _scheduled_at?: string
          _source: string
        }
        Returns: string
      }
      create_outgoing_chain: { Args: { _order: string }; Returns: string }
      create_purchase_need: {
        Args: {
          _mo?: string
          _needed_by?: string
          _notes?: string
          _origin: Database["public"]["Enums"]["purchase_need_origin"]
          _product: string
          _qty: number
          _sale?: string
        }
        Returns: string
      }
      create_return_from_picking: {
        Args: { _lines: Json; _picking_id: string }
        Returns: string
      }
      create_wave: { Args: { _moves: string[] }; Returns: string }
      customer_location_id: { Args: never; Returns: string }
      daily_finance_snapshot: { Args: { _date: string }; Returns: Json }
      dedupe_notifications_for_entity: {
        Args: { _entity_id: string; _entity_type: string; _type: string }
        Returns: number
      }
      default_location: {
        Args: { _name: string; _warehouse: string }
        Returns: string
      }
      default_warehouse_id: { Args: never; Returns: string }
      delivery_handover_to_carrier: {
        Args: {
          _carrier_id: string
          _schedule_id: string
          _tracking_code?: string
        }
        Returns: Json
      }
      delivery_load_vehicle: {
        Args: { _lines?: Json; _route_id: string }
        Returns: Json
      }
      delivery_order_deliver: {
        Args: { _lines: Json; _payment?: Json; _route_order_id: string }
        Returns: Json
      }
      delivery_order_fail: {
        Args: { _reason: string; _route_order_id: string }
        Returns: Json
      }
      delivery_pick_to_dock: {
        Args: { _dock_id: string; _lane_id?: string; _route_id: string }
        Returns: Json
      }
      delivery_pick_to_pickup_area: {
        Args: { _pickup_id: string }
        Returns: Json
      }
      delivery_return_to_warehouse: {
        Args: { _lines: Json; _mode?: string; _route_order_id: string }
        Returns: Json
      }
      delivery_route_assign_order: {
        Args: {
          _force?: boolean
          _override_reason?: string
          _route_id: string
          _schedule_id: string
        }
        Returns: Json
      }
      delivery_route_capacity: { Args: { _route_id: string }; Returns: Json }
      delivery_route_cash_close: {
        Args: { _actuals: Json; _notes?: string; _route_id: string }
        Returns: Json
      }
      delivery_route_cash_summary: {
        Args: { _route_id: string }
        Returns: Json
      }
      delivery_route_change_vehicle: {
        Args: { _route_id: string; _vehicle_id: string }
        Returns: Json
      }
      delivery_route_close: { Args: { _route_id: string }; Returns: Json }
      delivery_route_complete: { Args: { _route_id: string }; Returns: Json }
      delivery_route_create_ad_hoc: {
        Args: {
          _assistant_id?: string
          _driver_id?: string
          _notes?: string
          _route_date: string
          _vehicle_id: string
          _zone_id: string
        }
        Returns: Json
      }
      delivery_route_start: { Args: { _route_id: string }; Returns: Json }
      delivery_schedule_assign: {
        Args: {
          _date: string
          _schedule_id: string
          _window_end?: string
          _window_start?: string
          _zone_id: string
        }
        Returns: Json
      }
      delivery_schedule_cancel: {
        Args: { _reason: string; _schedule_id: string }
        Returns: Json
      }
      delivery_schedule_create: {
        Args: {
          _delivery_address_id?: string
          _fulfillment_type: string
          _preferred_date: string
          _so_id: string
          _window_end?: string
          _window_start?: string
        }
        Returns: Json
      }
      delivery_schedule_reschedule: {
        Args: {
          _new_date: string
          _new_route_id?: string
          _reason?: string
          _schedule_id: string
        }
        Returns: Json
      }
      delivery_verify_load: {
        Args: { _manifest_ids: string[]; _route_id: string }
        Returns: Json
      }
      discuss_mark_read: { Args: { _channel: string }; Returns: undefined }
      discuss_open_dm: { Args: { _other: string }; Returns: string }
      driver_assign_batch: {
        Args: {
          _batch: string
          _date?: string
          _driver: string
          _vehicle: string
        }
        Returns: undefined
      }
      driver_deliver_picking: {
        Args: {
          _method_id?: string
          _payment_amount?: number
          _picking: string
        }
        Returns: Json
      }
      driver_deliver_picking_multi: {
        Args: { _payments: Json; _picking: string }
        Returns: Json
      }
      driver_handover_session: {
        Args: { _counted_cash?: number; _session: string }
        Returns: undefined
      }
      emit_event: {
        Args: {
          _entity_id?: string
          _entity_type?: string
          _event_type: string
          _payload?: Json
          _source_module: Database["public"]["Enums"]["app_module"]
        }
        Returns: string
      }
      ensure_balance_schedule: { Args: { _so: string }; Returns: undefined }
      ensure_packages_for_quant: {
        Args: {
          _force?: boolean
          _location_id: string
          _product_id: string
          _qty: number
        }
        Returns: Json
      }
      ensure_step_location: {
        Args: { _name: string; _warehouse: string }
        Returns: string
      }
      erp_health_check: { Args: { _threshold_days?: number }; Returns: Json }
      erp_health_check_run: {
        Args: { _threshold_days?: number }
        Returns: string
      }
      erp_health_remediate: {
        Args: { _mode?: string; _run_id: string }
        Returns: Json
      }
      erp_m3_health_check: { Args: never; Returns: Json }
      erp_m4_health_check: {
        Args: never
        Returns: {
          code: string
          detail: Json
          ref: string
          severity: string
        }[]
      }
      erp_package_health_check: { Args: never; Returns: Json }
      finance_reconcile_session: {
        Args: { _notes?: string; _session: string }
        Returns: undefined
      }
      find_zone_for_zip: { Args: { _zip: string }; Returns: string }
      generate_product_variants: { Args: { _product: string }; Returns: number }
      generate_recurring_delivery_routes: {
        Args: { _from: string; _to: string }
        Returns: Json
      }
      generate_routes: { Args: { _horizon_days?: number }; Returns: number }
      has_group: { Args: { _code: string; _uid: string }; Returns: boolean }
      has_permission: {
        Args: {
          _action: Database["public"]["Enums"]["permission_action"]
          _entity: string
          _module: Database["public"]["Enums"]["app_module"]
          _uid: string
        }
        Returns: boolean
      }
      is_module_installed: {
        Args: { _module: Database["public"]["Enums"]["app_module"] }
        Returns: boolean
      }
      is_package_tracking_enabled: { Args: never; Returns: boolean }
      is_package_tracking_enabled_for_product: {
        Args: { _product_id: string }
        Returns: boolean
      }
      lock_cash_session: { Args: { _session: string }; Returns: undefined }
      lock_order_payments: { Args: { _order: string }; Returns: undefined }
      lock_quant: {
        Args: { _location: string; _product: string }
        Returns: undefined
      }
      log_record_event: {
        Args: {
          _body: string
          _payload?: Json
          _record_id: string
          _record_type: string
        }
        Returns: undefined
      }
      log_stock_reservation: {
        Args: {
          _action: string
          _location: string
          _lot: string
          _notes?: string
          _origin: string
          _origin_type: string
          _product: string
          _qty: number
          _qty_after: number
          _qty_before: number
          _variant: string
        }
        Returns: undefined
      }
      merge_purchase_orders: {
        Args: { _sources: string[]; _target: string }
        Returns: undefined
      }
      mfg_available_qty: {
        Args: { _product: string; _variant: string }
        Returns: number
      }
      mfg_can_manage: { Args: { _uid: string }; Returns: boolean }
      mfg_can_operate: { Args: { _uid: string }; Returns: boolean }
      mfg_can_view: { Args: { _uid: string }; Returns: boolean }
      mfg_create_manual_mo: {
        Args: {
          _due: string
          _notes: string
          _origin: Database["public"]["Enums"]["mo_origin"]
          _planned_end: string
          _planned_start: string
          _priority: Database["public"]["Enums"]["mo_priority"]
          _product: string
          _qty: number
          _responsible: string
          _variant: string
        }
        Returns: string
      }
      mfg_create_mo_for_line: {
        Args: { _line: string; _so: string }
        Returns: string
      }
      mfg_create_needs_for_mo: { Args: { _mo: string }; Returns: number }
      mfg_create_orders_for_sale: { Args: { _so: string }; Returns: number }
      mfg_finish_operation: {
        Args: {
          _attachments?: Json
          _notes: string
          _op: string
          _qty_done: number
          _qty_scrap: number
        }
        Returns: undefined
      }
      mfg_next_code: { Args: never; Returns: string }
      mfg_pause_operation: {
        Args: { _op: string; _reason: string }
        Returns: undefined
      }
      mfg_quality_check: {
        Args: {
          _attachments?: Json
          _defects: string
          _mo: string
          _notes: string
          _result: Database["public"]["Enums"]["mo_qc_result"]
        }
        Returns: undefined
      }
      mfg_refresh_component: { Args: { _id: string }; Returns: undefined }
      mfg_refresh_mo_state: { Args: { _mo: string }; Returns: undefined }
      mfg_report_issue: {
        Args: {
          _attachments?: Json
          _description: string
          _kind: Database["public"]["Enums"]["mo_issue_kind"]
          _mo: string
          _op: string
        }
        Returns: undefined
      }
      mfg_resolve_issue: {
        Args: { _issue: string; _resolution: string }
        Returns: undefined
      }
      mfg_start_operation: { Args: { _op: string }; Returns: undefined }
      mfg_sync_sol_status: { Args: { _mo: string }; Returns: undefined }
      next_sequence: { Args: { _code: string }; Returns: string }
      notify_group: {
        Args: {
          _body?: string
          _entity_id?: string
          _entity_type?: string
          _group: string
          _link?: string
          _module: Database["public"]["Enums"]["app_module"]
          _payload?: Json
          _priority?: string
          _title: string
          _type: string
        }
        Returns: number
      }
      notify_user: {
        Args: {
          _body: string
          _link?: string
          _module: Database["public"]["Enums"]["app_module"]
          _title: string
          _type: string
          _user: string
        }
        Returns: undefined
      }
      open_cash_session: {
        Args: { _opening?: number; _register: string }
        Returns: string
      }
      package_backfill_dryrun: {
        Args: never
        Returns: {
          divergence: boolean
          existing_packages: number
          has_real_template: boolean
          internal_ref: string
          is_multi_location: boolean
          location_id: string
          location_name: string
          lot_id: string
          note: string
          packages_previstos: number
          product_id: string
          product_name: string
          qty_in_stock: number
          risco: string
          source: string
          template_total: number
        }[]
      }
      package_move: {
        Args: {
          _moved_qty?: number
          _package_id: string
          _reason?: string
          _stock_move_id?: string
          _to_bin_id?: string
          _to_location_id: string
          _to_pallet_id?: string
        }
        Returns: string
      }
      package_tracking_diagnostic: {
        Args: { _product_id: string }
        Returns: Json
      }
      picking_return_status: { Args: { _picking_id: string }; Returns: Json }
      picking_shortages: {
        Args: { _picking: string }
        Returns: {
          available: number
          demand: number
          product_id: string
          product_name: string
          shortage: number
        }[]
      }
      product_available_qty: {
        Args: { _product: string; _warehouse: string }
        Returns: number
      }
      purchase_can_manage: { Args: { _uid: string }; Returns: boolean }
      purchase_order_receipt_status: { Args: { _po_id: string }; Returns: Json }
      putaway_stock: {
        Args: {
          _location: string
          _package: string
          _product: string
          _qty: number
        }
        Returns: string
      }
      reallocate_freed_stock: {
        Args: { _exclude_so?: string; _product: string; _warehouse: string }
        Returns: Json
      }
      recalc_bill_state: { Args: { _bill: string }; Returns: undefined }
      recalc_payment_status: { Args: { _so: string }; Returns: undefined }
      recalc_picking_state: { Args: { _picking: string }; Returns: undefined }
      recalc_route_current: { Args: { _route: string }; Returns: undefined }
      recalc_so_fulfillment: { Args: { _so: string }; Returns: undefined }
      recompute_sale_fulfillment_status: {
        Args: { _so: string }
        Returns: string
      }
      recompute_sale_payment_status: { Args: { _so: string }; Returns: string }
      recompute_sale_state: { Args: { _so: string }; Returns: undefined }
      recompute_variant_quants: { Args: never; Returns: undefined }
      refresh_order_services: { Args: { _order: string }; Returns: undefined }
      refund_customer_payment: {
        Args: { _payment: string; _reason?: string }
        Returns: string
      }
      register_customer_payment: {
        Args: {
          _amount: number
          _idempotency_key?: string
          _journal?: string
          _method: string
          _order: string
          _payment_date?: string
          _reference?: string
          _schedule?: string
        }
        Returns: {
          amount: number
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string | null
          journal_id: string | null
          method_id: string | null
          name: string
          notes: string | null
          order_id: string | null
          partner_id: string | null
          payment_date: string
          reference: string | null
          refund_of: string | null
          schedule_id: string | null
          state: string
        }
        SetofOptions: {
          from: "*"
          to: "customer_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_mo_reservation: { Args: { _mo: string }; Returns: undefined }
      release_move_reservation: { Args: { _move: string }; Returns: undefined }
      release_move_reservation_partial: {
        Args: { _move: string; _qty: number }
        Returns: number
      }
      release_orphan_reservations: { Args: never; Returns: number }
      replan_picking_chain: { Args: { _picking: string }; Returns: Json }
      reschedule_picking: {
        Args: { _new_date: string; _picking: string; _reason: string }
        Returns: string
      }
      reserve_for_move: { Args: { _move: string }; Returns: number }
      reserve_incoming_to_origin_so: {
        Args: { _picking: string }
        Returns: undefined
      }
      reserve_mo: { Args: { _mo: string }; Returns: Json }
      reserve_picking_strict: { Args: { _picking: string }; Returns: Json }
      route_capacity_used: {
        Args: { _route: string }
        Returns: {
          assembly_minutes: number
          deliveries: number
        }[]
      }
      run_reordering_rules: { Args: never; Returns: number }
      sale_line_packages_ready: {
        Args: { _sale_order_line_id: string }
        Returns: Json
      }
      sale_order_reconciliation: { Args: { _order_id: string }; Returns: Json }
      scan_increment_move: {
        Args: { _delta?: number; _move: string }
        Returns: Json
      }
      scan_set_move_done: {
        Args: { _lot?: string; _move: string; _qty: number }
        Returns: Json
      }
      schedule_footprint: { Args: { _sale_order_id: string }; Returns: Json }
      schedule_picking_to_route: {
        Args: { _picking: string; _route: string }
        Returns: undefined
      }
      seed_default_schedule: { Args: { _so: string }; Returns: undefined }
      service_sla_adjust: {
        Args: { _new_due: string; _reason: string; _request_id: string }
        Returns: undefined
      }
      service_sla_extend: {
        Args: { _minutes: number; _reason: string; _request_id: string }
        Returns: undefined
      }
      service_sla_notify_check: { Args: never; Returns: Json }
      service_sla_pause: {
        Args: { _reason: string; _request_id: string }
        Returns: undefined
      }
      service_sla_resume: {
        Args: { _reason: string; _request_id: string }
        Returns: undefined
      }
      set_product_stock: {
        Args: {
          _product: string
          _qty: number
          _reason?: string
          _warehouse: string
        }
        Returns: number
      }
      so_classify_line: { Args: { _line_id: string }; Returns: Json }
      so_emit_timeline: {
        Args: {
          _line: string
          _payload: Json
          _ref: string
          _so: string
          _source: string
          _step: string
        }
        Returns: string
      }
      so_generate_delivery_picking: {
        Args: { _order_id: string }
        Returns: string
      }
      so_has_active_backorder: { Args: { _so: string }; Returns: boolean }
      so_is_scheduled: { Args: { _so: string }; Returns: boolean }
      so_is_settled: { Args: { _so: string }; Returns: boolean }
      so_product_available_now: {
        Args: { _product: string; _warehouse: string }
        Returns: number
      }
      so_product_in_production_qty: {
        Args: { _product: string; _warehouse: string }
        Returns: number
      }
      so_product_incoming_qty: {
        Args: { _product: string; _warehouse: string }
        Returns: number
      }
      so_rollup_operational_status: { Args: { _so: string }; Returns: string }
      so_root_id: { Args: { _order_id: string }; Returns: string }
      so_run_operational_plan: {
        Args: { _mode?: string; _order_id: string }
        Returns: Json
      }
      so_split_partial_delivery: { Args: { _order_id: string }; Returns: Json }
      suggest_route: {
        Args: { _from_date?: string; _so: string }
        Returns: {
          driver_id: string
          max_assembly_minutes: number
          max_deliveries: number
          route_date: string
          route_id: string
          used_assembly_minutes: number
          used_deliveries: number
          vehicle_id: string
          would_exceed: boolean
          zone_id: string
          zone_name: string
        }[]
      }
      supplier_location_id: { Args: never; Returns: string }
      tg_route_recompute_current_manual: {
        Args: { _route_id: string }
        Returns: undefined
      }
      transfer_reservation: {
        Args: {
          _from_move: string
          _qty: number
          _reason?: string
          _to_so: string
        }
        Returns: Json
      }
      try_reserve_picking: { Args: { _picking: string }; Returns: undefined }
      validate_batch: { Args: { _batch: string }; Returns: Json }
      validate_customer_pickup: {
        Args: { _payment?: Json; _pickup_id: string }
        Returns: Json
      }
      validate_picking: { Args: { _picking: string }; Returns: undefined }
      validate_wave: { Args: { _wave: string }; Returns: undefined }
    }
    Enums: {
      app_module:
        | "core"
        | "products"
        | "sales"
        | "purchase"
        | "inventory"
        | "finance"
        | "hr"
        | "cashbox"
        | "discuss"
        | "delivery"
        | "routes"
        | "barcode"
        | "service"
        | "manufacturing"
        | "shop_floor"
      bom_type: "normal" | "phantom" | "subcontract"
      location_type:
        | "internal"
        | "supplier"
        | "customer"
        | "transit"
        | "inventory_loss"
        | "production"
        | "view"
      mo_component_status:
        | "pending"
        | "reserved"
        | "partial"
        | "consumed"
        | "missing"
      mo_issue_kind:
        | "material_missing"
        | "damaged"
        | "wrong_measure"
        | "defect"
        | "priority_blocked"
        | "other"
      mo_op_state:
        | "pending"
        | "ready"
        | "in_progress"
        | "paused"
        | "done"
        | "blocked"
      mo_origin: "sale" | "manual" | "replenishment" | "rework" | "other"
      mo_priority: "low" | "normal" | "high" | "urgent"
      mo_qc_result: "pass" | "fail" | "rework"
      mo_state:
        | "draft"
        | "waiting_material"
        | "ready"
        | "in_progress"
        | "paused"
        | "qc"
        | "done"
        | "cancelled"
      package_condition:
        | "good"
        | "damaged"
        | "quarantine"
        | "missing"
        | "repaired"
      package_damage_status:
        | "reported"
        | "in_quarantine"
        | "in_repair"
        | "repaired"
        | "scrapped"
        | "replaced"
      package_status:
        | "expected"
        | "received"
        | "produced"
        | "available"
        | "reserved"
        | "picked"
        | "at_dock"
        | "loaded"
        | "delivered"
        | "returned"
        | "cancelled"
      pallet_status: "active" | "moved" | "closed" | "damaged"
      partner_kind: "individual" | "company"
      permission_action: "view" | "create" | "edit" | "delete" | "export"
      picking_kind:
        | "incoming"
        | "outgoing"
        | "internal"
        | "manufacturing"
        | "return"
      picking_state: "draft" | "waiting" | "ready" | "done" | "cancelled"
      product_tracking: "none" | "lot" | "serial"
      product_type: "storable" | "consumable" | "service"
      purchase_need_origin:
        | "sale"
        | "manufacturing"
        | "min_stock"
        | "manual"
        | "forecast"
      purchase_need_state:
        | "pending"
        | "quoting"
        | "approved"
        | "po_created"
        | "partially_received"
        | "received"
        | "cancelled"
      purchase_state: "draft" | "rfq_sent" | "confirmed" | "done" | "cancelled"
      removal_strategy: "fifo" | "lifo" | "fefo" | "closest"
      return_kind: "good" | "damaged" | "quarantine"
      sale_state: "draft" | "sent" | "confirmed" | "done" | "cancelled"
      sol_mfg_status:
        | "none"
        | "pending"
        | "waiting_material"
        | "in_production"
        | "qc"
        | "ready_for_delivery"
        | "cancelled"
      supply_link_kind:
        | "purchase_need"
        | "purchase_order_line"
        | "manufacturing_order"
        | "stock_reservation"
      supply_link_state: "active" | "consumed" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_module: [
        "core",
        "products",
        "sales",
        "purchase",
        "inventory",
        "finance",
        "hr",
        "cashbox",
        "discuss",
        "delivery",
        "routes",
        "barcode",
        "service",
        "manufacturing",
        "shop_floor",
      ],
      bom_type: ["normal", "phantom", "subcontract"],
      location_type: [
        "internal",
        "supplier",
        "customer",
        "transit",
        "inventory_loss",
        "production",
        "view",
      ],
      mo_component_status: [
        "pending",
        "reserved",
        "partial",
        "consumed",
        "missing",
      ],
      mo_issue_kind: [
        "material_missing",
        "damaged",
        "wrong_measure",
        "defect",
        "priority_blocked",
        "other",
      ],
      mo_op_state: [
        "pending",
        "ready",
        "in_progress",
        "paused",
        "done",
        "blocked",
      ],
      mo_origin: ["sale", "manual", "replenishment", "rework", "other"],
      mo_priority: ["low", "normal", "high", "urgent"],
      mo_qc_result: ["pass", "fail", "rework"],
      mo_state: [
        "draft",
        "waiting_material",
        "ready",
        "in_progress",
        "paused",
        "qc",
        "done",
        "cancelled",
      ],
      package_condition: [
        "good",
        "damaged",
        "quarantine",
        "missing",
        "repaired",
      ],
      package_damage_status: [
        "reported",
        "in_quarantine",
        "in_repair",
        "repaired",
        "scrapped",
        "replaced",
      ],
      package_status: [
        "expected",
        "received",
        "produced",
        "available",
        "reserved",
        "picked",
        "at_dock",
        "loaded",
        "delivered",
        "returned",
        "cancelled",
      ],
      pallet_status: ["active", "moved", "closed", "damaged"],
      partner_kind: ["individual", "company"],
      permission_action: ["view", "create", "edit", "delete", "export"],
      picking_kind: [
        "incoming",
        "outgoing",
        "internal",
        "manufacturing",
        "return",
      ],
      picking_state: ["draft", "waiting", "ready", "done", "cancelled"],
      product_tracking: ["none", "lot", "serial"],
      product_type: ["storable", "consumable", "service"],
      purchase_need_origin: [
        "sale",
        "manufacturing",
        "min_stock",
        "manual",
        "forecast",
      ],
      purchase_need_state: [
        "pending",
        "quoting",
        "approved",
        "po_created",
        "partially_received",
        "received",
        "cancelled",
      ],
      purchase_state: ["draft", "rfq_sent", "confirmed", "done", "cancelled"],
      removal_strategy: ["fifo", "lifo", "fefo", "closest"],
      return_kind: ["good", "damaged", "quarantine"],
      sale_state: ["draft", "sent", "confirmed", "done", "cancelled"],
      sol_mfg_status: [
        "none",
        "pending",
        "waiting_material",
        "in_production",
        "qc",
        "ready_for_delivery",
        "cancelled",
      ],
      supply_link_kind: [
        "purchase_need",
        "purchase_order_line",
        "manufacturing_order",
        "stock_reservation",
      ],
      supply_link_state: ["active", "consumed", "cancelled"],
    },
  },
} as const
