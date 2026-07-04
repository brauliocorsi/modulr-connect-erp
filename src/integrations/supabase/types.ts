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
      _p20_run_log: {
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
      _phase17_runs: {
        Row: {
          id: number
          result: Json | null
          run_at: string | null
        }
        Insert: {
          id?: number
          result?: Json | null
          run_at?: string | null
        }
        Update: {
          id?: number
          result?: Json | null
          run_at?: string | null
        }
        Relationships: []
      }
      _test_phase17_log: {
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
      _test_regression_log: {
        Row: {
          id: number
          ran_at: string | null
          result: Json | null
          test: string | null
        }
        Insert: {
          id?: number
          ran_at?: string | null
          result?: Json | null
          test?: string | null
        }
        Update: {
          id?: number
          ran_at?: string | null
          result?: Json | null
          test?: string | null
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
      activity_events: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          event_type: string
          id: string
          message: string | null
          metadata: Json
          visibility: string
        }
        Insert: {
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          event_type: string
          id?: string
          message?: string | null
          metadata?: Json
          visibility?: string
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          event_type?: string
          id?: string
          message?: string | null
          metadata?: Json
          visibility?: string
        }
        Relationships: []
      }
      allocation_decisions: {
        Row: {
          created_at: string
          id: string
          payload: Json | null
          product_id: string
          qty: number
          reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_sale_order_line_id: string | null
          state: string
          suggested_target_line_id: string | null
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json | null
          product_id: string
          qty: number
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_sale_order_line_id?: string | null
          state?: string
          suggested_target_line_id?: string | null
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json | null
          product_id?: string
          qty?: number
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_sale_order_line_id?: string | null
          state?: string
          suggested_target_line_id?: string | null
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "allocation_decisions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "allocation_decisions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_decisions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
        ]
      }
      allocation_hook_events: {
        Row: {
          created_at: string
          error: string | null
          error_detail: Json | null
          error_message: string | null
          event_type: string
          id: string
          location_id: string | null
          product_id: string | null
          qty: number | null
          result: Json | null
          source_event_id: string
          source_id: string
          status: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          error_detail?: Json | null
          error_message?: string | null
          event_type: string
          id?: string
          location_id?: string | null
          product_id?: string | null
          qty?: number | null
          result?: Json | null
          source_event_id: string
          source_id: string
          status?: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          error_detail?: Json | null
          error_message?: string | null
          event_type?: string
          id?: string
          location_id?: string | null
          product_id?: string | null
          qty?: number | null
          result?: Json | null
          source_event_id?: string
          source_id?: string
          status?: string
          variant_id?: string | null
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
      bank_reconciliation_batches: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          source?: string
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      bank_reconciliation_lines: {
        Row: {
          amount: number
          batch_id: string | null
          created_at: string
          created_by: string | null
          direction: string
          id: string
          matched_at: string | null
          matched_by: string | null
          notes: string | null
          occurred_at: string
          payment_id: string | null
          reference: string | null
          status: string
          supplier_payment_id: string | null
        }
        Insert: {
          amount: number
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string
          id?: string
          matched_at?: string | null
          matched_by?: string | null
          notes?: string | null
          occurred_at?: string
          payment_id?: string | null
          reference?: string | null
          status?: string
          supplier_payment_id?: string | null
        }
        Update: {
          amount?: number
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string
          id?: string
          matched_at?: string | null
          matched_by?: string | null
          notes?: string | null
          occurred_at?: string
          payment_id?: string | null
          reference?: string | null
          status?: string
          supplier_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_reconciliation_lines_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "bank_reconciliation_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_reconciliation_lines_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "bnpl_pending_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_reconciliation_lines_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "customer_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_reconciliation_lines_supplier_payment_id_fkey"
            columns: ["supplier_payment_id"]
            isOneToOne: false
            referencedRelation: "supplier_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_imports: {
        Row: {
          column_map: Json | null
          created_at: string
          created_by: string | null
          file_kind: string | null
          file_name: string | null
          id: string
          journal_id: string | null
          name: string
          notes: string | null
          rows_matched: number
          rows_total: number
          status: string
        }
        Insert: {
          column_map?: Json | null
          created_at?: string
          created_by?: string | null
          file_kind?: string | null
          file_name?: string | null
          id?: string
          journal_id?: string | null
          name: string
          notes?: string | null
          rows_matched?: number
          rows_total?: number
          status?: string
        }
        Update: {
          column_map?: Json | null
          created_at?: string
          created_by?: string | null
          file_kind?: string | null
          file_name?: string | null
          id?: string
          journal_id?: string | null
          name?: string
          notes?: string | null
          rows_matched?: number
          rows_total?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_imports_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "account_journals"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_lines: {
        Row: {
          amount: number
          balance: number | null
          created_at: string
          description: string | null
          id: string
          import_id: string
          line_hash: string
          match_status: string
          matched_at: string | null
          matched_by: string | null
          occurred_on: string
          raw: Json | null
          reference: string | null
          suggested_payment_id: string | null
          suggested_supplier_payment_id: string | null
        }
        Insert: {
          amount: number
          balance?: number | null
          created_at?: string
          description?: string | null
          id?: string
          import_id: string
          line_hash: string
          match_status?: string
          matched_at?: string | null
          matched_by?: string | null
          occurred_on: string
          raw?: Json | null
          reference?: string | null
          suggested_payment_id?: string | null
          suggested_supplier_payment_id?: string | null
        }
        Update: {
          amount?: number
          balance?: number | null
          created_at?: string
          description?: string | null
          id?: string
          import_id?: string
          line_hash?: string
          match_status?: string
          matched_at?: string | null
          matched_by?: string | null
          occurred_on?: string
          raw?: Json | null
          reference?: string | null
          suggested_payment_id?: string | null
          suggested_supplier_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_lines_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "bank_statement_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_suggested_payment_id_fkey"
            columns: ["suggested_payment_id"]
            isOneToOne: false
            referencedRelation: "bnpl_pending_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_suggested_payment_id_fkey"
            columns: ["suggested_payment_id"]
            isOneToOne: false
            referencedRelation: "customer_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_suggested_supplier_payment_id_fkey"
            columns: ["suggested_supplier_payment_id"]
            isOneToOne: false
            referencedRelation: "supplier_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_lines: {
        Row: {
          applies_to_variant_rule: Json | null
          bom_id: string
          component_product_id: string
          component_selector: Json | null
          component_variant_id: string | null
          consumption_uom_id: string | null
          conversion_factor: number | null
          formula: string | null
          formula_variables: Json | null
          id: string
          inheritance_action: string
          is_critical: boolean | null
          is_inherited: boolean
          is_optional: boolean
          operation_id: string | null
          parent_bom_line_id: string | null
          qty_formula: string | null
          quantity: number
          rounding_method: string
          sequence: number
          uom_id: string | null
          work_center_id: string | null
        }
        Insert: {
          applies_to_variant_rule?: Json | null
          bom_id: string
          component_product_id: string
          component_selector?: Json | null
          component_variant_id?: string | null
          consumption_uom_id?: string | null
          conversion_factor?: number | null
          formula?: string | null
          formula_variables?: Json | null
          id?: string
          inheritance_action?: string
          is_critical?: boolean | null
          is_inherited?: boolean
          is_optional?: boolean
          operation_id?: string | null
          parent_bom_line_id?: string | null
          qty_formula?: string | null
          quantity?: number
          rounding_method?: string
          sequence?: number
          uom_id?: string | null
          work_center_id?: string | null
        }
        Update: {
          applies_to_variant_rule?: Json | null
          bom_id?: string
          component_product_id?: string
          component_selector?: Json | null
          component_variant_id?: string | null
          consumption_uom_id?: string | null
          conversion_factor?: number | null
          formula?: string | null
          formula_variables?: Json | null
          id?: string
          inheritance_action?: string
          is_critical?: boolean | null
          is_inherited?: boolean
          is_optional?: boolean
          operation_id?: string | null
          parent_bom_line_id?: string | null
          qty_formula?: string | null
          quantity?: number
          rounding_method?: string
          sequence?: number
          uom_id?: string | null
          work_center_id?: string | null
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
            foreignKeyName: "bom_lines_consumption_uom_id_fkey"
            columns: ["consumption_uom_id"]
            isOneToOne: false
            referencedRelation: "product_uom"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "bom_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_parent_bom_line_id_fkey"
            columns: ["parent_bom_line_id"]
            isOneToOne: false
            referencedRelation: "bom_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "product_uom"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_operations: {
        Row: {
          active: boolean
          bom_id: string
          cleanup_time_minutes: number
          code: string | null
          duration_minutes: number
          id: string
          instructions: string | null
          name: string
          requires_employee: boolean
          requires_machine: boolean
          requires_quality_check: boolean
          sequence: number
          setup_time_minutes: number
          work_center_id: string | null
          workcenter: string | null
        }
        Insert: {
          active?: boolean
          bom_id: string
          cleanup_time_minutes?: number
          code?: string | null
          duration_minutes?: number
          id?: string
          instructions?: string | null
          name: string
          requires_employee?: boolean
          requires_machine?: boolean
          requires_quality_check?: boolean
          sequence?: number
          setup_time_minutes?: number
          work_center_id?: string | null
          workcenter?: string | null
        }
        Update: {
          active?: boolean
          bom_id?: string
          cleanup_time_minutes?: number
          code?: string | null
          duration_minutes?: number
          id?: string
          instructions?: string | null
          name?: string
          requires_employee?: boolean
          requires_machine?: boolean
          requires_quality_check?: boolean
          sequence?: number
          setup_time_minutes?: number
          work_center_id?: string | null
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
          {
            foreignKeyName: "bom_operations_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_variant_rules: {
        Row: {
          active: boolean
          attribute_name: string | null
          attribute_value: string | null
          bom_id: string
          created_at: string
          formula: string | null
          id: string
          priority: number
          product_id: string | null
          qty: number | null
          rule_type: string
          source_component_id: string | null
          target_component_id: string | null
          uom_id: string | null
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          active?: boolean
          attribute_name?: string | null
          attribute_value?: string | null
          bom_id: string
          created_at?: string
          formula?: string | null
          id?: string
          priority?: number
          product_id?: string | null
          qty?: number | null
          rule_type: string
          source_component_id?: string | null
          target_component_id?: string | null
          uom_id?: string | null
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          active?: boolean
          attribute_name?: string | null
          attribute_value?: string | null
          bom_id?: string
          created_at?: string
          formula?: string | null
          id?: string
          priority?: number
          product_id?: string | null
          qty?: number | null
          rule_type?: string
          source_component_id?: string | null
          target_component_id?: string | null
          uom_id?: string | null
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bom_variant_rules_bom_id_fkey"
            columns: ["bom_id"]
            isOneToOne: false
            referencedRelation: "boms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_variant_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "bom_variant_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_variant_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "bom_variant_rules_source_component_id_fkey"
            columns: ["source_component_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "bom_variant_rules_source_component_id_fkey"
            columns: ["source_component_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_variant_rules_source_component_id_fkey"
            columns: ["source_component_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "bom_variant_rules_target_component_id_fkey"
            columns: ["target_component_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "bom_variant_rules_target_component_id_fkey"
            columns: ["target_component_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_variant_rules_target_component_id_fkey"
            columns: ["target_component_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "bom_variant_rules_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "product_uom"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_variant_rules_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      boms: {
        Row: {
          active: boolean
          applies_to_product_id: string | null
          applies_to_variant_id: string | null
          code: string | null
          created_at: string
          id: string
          inheritance_mode: string
          is_master: boolean
          parent_bom_id: string | null
          product_id: string
          quantity: number
          type: Database["public"]["Enums"]["bom_type"]
          uom_id: string | null
          variant_id: string | null
          variant_rule: Json | null
        }
        Insert: {
          active?: boolean
          applies_to_product_id?: string | null
          applies_to_variant_id?: string | null
          code?: string | null
          created_at?: string
          id?: string
          inheritance_mode?: string
          is_master?: boolean
          parent_bom_id?: string | null
          product_id: string
          quantity?: number
          type?: Database["public"]["Enums"]["bom_type"]
          uom_id?: string | null
          variant_id?: string | null
          variant_rule?: Json | null
        }
        Update: {
          active?: boolean
          applies_to_product_id?: string | null
          applies_to_variant_id?: string | null
          code?: string | null
          created_at?: string
          id?: string
          inheritance_mode?: string
          is_master?: boolean
          parent_bom_id?: string | null
          product_id?: string
          quantity?: number
          type?: Database["public"]["Enums"]["bom_type"]
          uom_id?: string | null
          variant_id?: string | null
          variant_rule?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "boms_applies_to_product_id_fkey"
            columns: ["applies_to_product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "boms_applies_to_product_id_fkey"
            columns: ["applies_to_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boms_applies_to_product_id_fkey"
            columns: ["applies_to_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "boms_applies_to_variant_id_fkey"
            columns: ["applies_to_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boms_parent_bom_id_fkey"
            columns: ["parent_bom_id"]
            isOneToOne: false
            referencedRelation: "boms"
            referencedColumns: ["id"]
          },
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
          account_id: string | null
          amount: number
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          id: string
          kind: string
          migration_note: string | null
          notes: string | null
          partner_id: string | null
          payment_id: string | null
          picking_id: string | null
          reconciled_at: string | null
          reconciled_by: string | null
          reference: string | null
          reversal_of_id: string | null
          reversal_reason: string | null
          route_id: string | null
          session_id: string
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          amount: number
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          migration_note?: string | null
          notes?: string | null
          partner_id?: string | null
          payment_id?: string | null
          picking_id?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          reference?: string | null
          reversal_of_id?: string | null
          reversal_reason?: string | null
          route_id?: string | null
          session_id: string
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          migration_note?: string | null
          notes?: string | null
          partner_id?: string | null
          payment_id?: string | null
          picking_id?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          reference?: string | null
          reversal_of_id?: string | null
          reversal_reason?: string | null
          route_id?: string | null
          session_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "bnpl_pending_settlements"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "cash_movements_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
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
      chart_of_accounts: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          notes: string | null
          parent_id: string | null
          type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          parent_id?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          parent_id?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
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
      conversation_attachments: {
        Row: {
          attachment_type: string | null
          created_at: string
          file_name: string | null
          file_type: string | null
          file_url: string | null
          id: string
          message_id: string
        }
        Insert: {
          attachment_type?: string | null
          created_at?: string
          file_name?: string | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          message_id: string
        }
        Update: {
          attachment_type?: string | null
          created_at?: string
          file_name?: string | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "conversation_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_messages: {
        Row: {
          created_at: string
          edited_at: string | null
          id: string
          message: string
          metadata: Json
          sender_partner_id: string | null
          sender_type: string
          sender_user_id: string | null
          thread_id: string
          visibility: string
        }
        Insert: {
          created_at?: string
          edited_at?: string | null
          id?: string
          message: string
          metadata?: Json
          sender_partner_id?: string | null
          sender_type: string
          sender_user_id?: string | null
          thread_id: string
          visibility?: string
        }
        Update: {
          created_at?: string
          edited_at?: string | null
          id?: string
          message?: string
          metadata?: Json
          sender_partner_id?: string | null
          sender_type?: string
          sender_user_id?: string | null
          thread_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "conversation_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          id: string
          joined_at: string
          last_read_at: string | null
          left_at: string | null
          muted: boolean
          participant_type: string
          partner_id: string | null
          pinned: boolean
          role: string
          thread_id: string
          unread_count: number
          user_id: string | null
        }
        Insert: {
          id?: string
          joined_at?: string
          last_read_at?: string | null
          left_at?: string | null
          muted?: boolean
          participant_type: string
          partner_id?: string | null
          pinned?: boolean
          role?: string
          thread_id: string
          unread_count?: number
          user_id?: string | null
        }
        Update: {
          id?: string
          joined_at?: string
          last_read_at?: string | null
          left_at?: string | null
          muted?: boolean
          participant_type?: string
          partner_id?: string | null
          pinned?: boolean
          role?: string
          thread_id?: string
          unread_count?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "conversation_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_threads: {
        Row: {
          channel_id: string | null
          close_reason: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_archived: boolean
          last_message_at: string | null
          status: string
          thread_type: string
          title: string
          visibility: string
        }
        Insert: {
          channel_id?: string | null
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_archived?: boolean
          last_message_at?: string | null
          status?: string
          thread_type?: string
          title: string
          visibility?: string
        }
        Update: {
          channel_id?: string | null
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_archived?: boolean
          last_message_at?: string | null
          status?: string
          thread_type?: string
          title?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_threads_channel_fk"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
        ]
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
      customer_credit_applications: {
        Row: {
          amount: number
          applied_at: string
          applied_by: string | null
          credit_id: string
          customer_payment_id: string | null
          id: string
          notes: string | null
          reversed_at: string | null
          reversed_by: string | null
          sale_order_id: string | null
        }
        Insert: {
          amount: number
          applied_at?: string
          applied_by?: string | null
          credit_id: string
          customer_payment_id?: string | null
          id?: string
          notes?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          sale_order_id?: string | null
        }
        Update: {
          amount?: number
          applied_at?: string
          applied_by?: string | null
          credit_id?: string
          customer_payment_id?: string | null
          id?: string
          notes?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          sale_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_credit_applications_credit_id_fkey"
            columns: ["credit_id"]
            isOneToOne: false
            referencedRelation: "customer_credits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_credit_applications_customer_payment_id_fkey"
            columns: ["customer_payment_id"]
            isOneToOne: false
            referencedRelation: "bnpl_pending_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_credit_applications_customer_payment_id_fkey"
            columns: ["customer_payment_id"]
            isOneToOne: false
            referencedRelation: "customer_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_credit_applications_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "customer_credit_applications_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_credit_applications_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_credit_applications_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "customer_credit_applications_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "customer_credit_applications_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      customer_credits: {
        Row: {
          amount: number
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string | null
          origin_payment_id: string | null
          origin_service_case_id: string | null
          partner_id: string
          reason: string | null
          remaining_amount: number
          state: string
        }
        Insert: {
          amount: number
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          origin_payment_id?: string | null
          origin_service_case_id?: string | null
          partner_id: string
          reason?: string | null
          remaining_amount: number
          state?: string
        }
        Update: {
          amount?: number
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          origin_payment_id?: string | null
          origin_service_case_id?: string | null
          partner_id?: string
          reason?: string | null
          remaining_amount?: number
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_credits_origin_payment_id_fkey"
            columns: ["origin_payment_id"]
            isOneToOne: false
            referencedRelation: "bnpl_pending_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_credits_origin_payment_id_fkey"
            columns: ["origin_payment_id"]
            isOneToOne: false
            referencedRelation: "customer_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_credits_origin_service_case_id_fkey"
            columns: ["origin_service_case_id"]
            isOneToOne: false
            referencedRelation: "service_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_credits_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_payments: {
        Row: {
          account_id: string | null
          amount: number
          cash_session_id: string | null
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
          reconciled_at: string | null
          reconciled_by: string | null
          reconciliation_line_id: string | null
          reconciliation_status: string
          reference: string | null
          refund_of: string | null
          schedule_id: string | null
          state: string
          store_id: string | null
        }
        Insert: {
          account_id?: string | null
          amount: number
          cash_session_id?: string | null
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
          reconciled_at?: string | null
          reconciled_by?: string | null
          reconciliation_line_id?: string | null
          reconciliation_status?: string
          reference?: string | null
          refund_of?: string | null
          schedule_id?: string | null
          state?: string
          store_id?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          cash_session_id?: string | null
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
          reconciled_at?: string | null
          reconciled_by?: string | null
          reconciliation_line_id?: string | null
          reconciliation_status?: string
          reference?: string | null
          refund_of?: string | null
          schedule_id?: string | null
          state?: string
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_payments_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "customer_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "customer_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "customer_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
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
            referencedRelation: "bnpl_pending_settlements"
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
          {
            foreignKeyName: "customer_payments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
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
          {
            foreignKeyName: "customer_pickups_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_pickups_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "customer_pickups_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "customer_pickups_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      customer_portal_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          expires_at: string
          id: string
          revoked_at: string | null
          sale_order_id: string | null
          scope: string
          service_case_id: string | null
          status: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          sale_order_id?: string | null
          scope?: string
          service_case_id?: string | null
          status?: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          sale_order_id?: string | null
          scope?: string
          service_case_id?: string | null
          status?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_portal_tokens_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_portal_tokens_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "customer_portal_tokens_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_portal_tokens_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_portal_tokens_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "customer_portal_tokens_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "customer_portal_tokens_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "customer_portal_tokens_service_case_id_fkey"
            columns: ["service_case_id"]
            isOneToOne: false
            referencedRelation: "service_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_ticket_attachments: {
        Row: {
          attachment_type: string
          created_at: string
          file_name: string
          file_type: string | null
          file_url: string | null
          id: string
          message_id: string | null
          ticket_id: string
          uploaded_by_customer: boolean
          uploaded_by_user_id: string | null
        }
        Insert: {
          attachment_type?: string
          created_at?: string
          file_name: string
          file_type?: string | null
          file_url?: string | null
          id?: string
          message_id?: string | null
          ticket_id: string
          uploaded_by_customer?: boolean
          uploaded_by_user_id?: string | null
        }
        Update: {
          attachment_type?: string
          created_at?: string
          file_name?: string
          file_type?: string | null
          file_url?: string | null
          id?: string
          message_id?: string | null
          ticket_id?: string
          uploaded_by_customer?: boolean
          uploaded_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_ticket_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "customer_ticket_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_ticket_attachments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "customer_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_ticket_messages: {
        Row: {
          created_at: string
          customer_id: string | null
          id: string
          internal: boolean
          message: string
          sender_type: string
          sender_user_id: string | null
          ticket_id: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          id?: string
          internal?: boolean
          message: string
          sender_type: string
          sender_user_id?: string | null
          ticket_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          id?: string
          internal?: boolean
          message?: string
          sender_type?: string
          sender_user_id?: string | null
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_ticket_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "customer_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_tickets: {
        Row: {
          assigned_to: string | null
          category: string
          closed_at: string | null
          created_at: string
          created_by: string | null
          created_by_customer: boolean
          customer_id: string
          delivery_schedule_id: string | null
          description: string | null
          id: string
          priority: string
          sale_order_id: string | null
          sale_order_line_id: string | null
          service_case_id: string | null
          source: string
          status: string
          subject: string
          ticket_number: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category?: string
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_customer?: boolean
          customer_id: string
          delivery_schedule_id?: string | null
          description?: string | null
          id?: string
          priority?: string
          sale_order_id?: string | null
          sale_order_line_id?: string | null
          service_case_id?: string | null
          source?: string
          status?: string
          subject: string
          ticket_number: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: string
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_customer?: boolean
          customer_id?: string
          delivery_schedule_id?: string | null
          description?: string | null
          id?: string
          priority?: string
          sale_order_id?: string | null
          sale_order_line_id?: string | null
          service_case_id?: string | null
          source?: string
          status?: string
          subject?: string
          ticket_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_tickets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_tickets_delivery_schedule_id_fkey"
            columns: ["delivery_schedule_id"]
            isOneToOne: false
            referencedRelation: "delivery_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_tickets_delivery_schedule_id_fkey"
            columns: ["delivery_schedule_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["schedule_id"]
          },
          {
            foreignKeyName: "customer_tickets_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "customer_tickets_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_tickets_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_tickets_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "customer_tickets_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "customer_tickets_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "customer_tickets_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_tickets_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_line_id"]
          },
          {
            foreignKeyName: "customer_tickets_service_case_id_fkey"
            columns: ["service_case_id"]
            isOneToOne: false
            referencedRelation: "service_cases"
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
          actual_multibanco: number
          actual_other: number
          actual_transfer: number
          bnpl_informational: Json
          cash_register_id: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          expected_cash: number
          expected_mbway: number
          expected_multibanco: number
          expected_other: number
          expected_transfer: number
          id: string
          method_breakdown: Json
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
          actual_multibanco?: number
          actual_other?: number
          actual_transfer?: number
          bnpl_informational?: Json
          cash_register_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          expected_cash?: number
          expected_mbway?: number
          expected_multibanco?: number
          expected_other?: number
          expected_transfer?: number
          id?: string
          method_breakdown?: Json
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
          actual_multibanco?: number
          actual_other?: number
          actual_transfer?: number
          bnpl_informational?: Json
          cash_register_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          expected_cash?: number
          expected_mbway?: number
          expected_multibanco?: number
          expected_other?: number
          expected_transfer?: number
          id?: string
          method_breakdown?: Json
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
          {
            foreignKeyName: "delivery_route_orders_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["schedule_id"]
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
          created_by: string | null
          current_assembly_minutes: number
          current_deliveries: number
          current_volume_m3: number
          current_weight_kg: number
          dock_id: string | null
          driver_id: string | null
          helper_id: string | null
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
          created_by?: string | null
          current_assembly_minutes?: number
          current_deliveries?: number
          current_volume_m3?: number
          current_weight_kg?: number
          dock_id?: string | null
          driver_id?: string | null
          helper_id?: string | null
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
          created_by?: string | null
          current_assembly_minutes?: number
          current_deliveries?: number
          current_volume_m3?: number
          current_weight_kg?: number
          dock_id?: string | null
          driver_id?: string | null
          helper_id?: string | null
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
            foreignKeyName: "delivery_routes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "delivery_routes_helper_id_fkey"
            columns: ["helper_id"]
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
          service_case_id: string | null
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
          service_case_id?: string | null
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
          service_case_id?: string | null
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
            foreignKeyName: "delivery_schedules_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_schedules_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "delivery_schedules_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "delivery_schedules_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "delivery_schedules_service_case_id_fkey"
            columns: ["service_case_id"]
            isOneToOne: false
            referencedRelation: "service_cases"
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
          {
            foreignKeyName: "dock_transfers_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["schedule_id"]
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
      erp_tasks: {
        Row: {
          assigned_group: string | null
          assigned_to: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
          priority: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_group?: string | null
          assigned_to?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          priority?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_group?: string | null
          assigned_to?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          priority?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
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
      manufacturing_bom_outputs: {
        Row: {
          active: boolean
          bom_id: string
          bom_line_id: string | null
          condition: string
          cost_allocation_percent: number | null
          created_at: string
          formula: string | null
          id: string
          operation_id: string | null
          output_type: string
          product_id: string
          qty: number
          stockable: boolean
          uom_id: string | null
          updated_at: string
          work_center_id: string | null
        }
        Insert: {
          active?: boolean
          bom_id: string
          bom_line_id?: string | null
          condition?: string
          cost_allocation_percent?: number | null
          created_at?: string
          formula?: string | null
          id?: string
          operation_id?: string | null
          output_type: string
          product_id: string
          qty?: number
          stockable?: boolean
          uom_id?: string | null
          updated_at?: string
          work_center_id?: string | null
        }
        Update: {
          active?: boolean
          bom_id?: string
          bom_line_id?: string | null
          condition?: string
          cost_allocation_percent?: number | null
          created_at?: string
          formula?: string | null
          id?: string
          operation_id?: string | null
          output_type?: string
          product_id?: string
          qty?: number
          stockable?: boolean
          uom_id?: string | null
          updated_at?: string
          work_center_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_bom_outputs_bom_id_fkey"
            columns: ["bom_id"]
            isOneToOne: false
            referencedRelation: "boms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_bom_outputs_bom_line_id_fkey"
            columns: ["bom_line_id"]
            isOneToOne: false
            referencedRelation: "bom_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_bom_outputs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "manufacturing_bom_outputs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_bom_outputs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "manufacturing_bom_outputs_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "product_uom"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_bom_outputs_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturing_machines: {
        Row: {
          active: boolean
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          capacity_per_hour: number | null
          code: string
          cost_per_hour: number | null
          created_at: string
          id: string
          last_maintenance_at: string | null
          machine_type: string | null
          maintenance_status: string
          name: string
          next_maintenance_at: string | null
          notes: string | null
          status: Database["public"]["Enums"]["machine_status"]
          updated_at: string
          work_center_id: string
        }
        Insert: {
          active?: boolean
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          capacity_per_hour?: number | null
          code: string
          cost_per_hour?: number | null
          created_at?: string
          id?: string
          last_maintenance_at?: string | null
          machine_type?: string | null
          maintenance_status?: string
          name: string
          next_maintenance_at?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["machine_status"]
          updated_at?: string
          work_center_id: string
        }
        Update: {
          active?: boolean
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          capacity_per_hour?: number | null
          code?: string
          cost_per_hour?: number | null
          created_at?: string
          id?: string
          last_maintenance_at?: string | null
          machine_type?: string | null
          maintenance_status?: string
          name?: string
          next_maintenance_at?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["machine_status"]
          updated_at?: string
          work_center_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_machines_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturing_operations: {
        Row: {
          active: boolean
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          code: string
          created_at: string
          default_work_center_id: string | null
          description: string | null
          id: string
          name: string
          requires_employee: boolean
          requires_machine: boolean
          requires_quality_check: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          code: string
          created_at?: string
          default_work_center_id?: string | null
          description?: string | null
          id?: string
          name: string
          requires_employee?: boolean
          requires_machine?: boolean
          requires_quality_check?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          code?: string
          created_at?: string
          default_work_center_id?: string | null
          description?: string | null
          id?: string
          name?: string
          requires_employee?: boolean
          requires_machine?: boolean
          requires_quality_check?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_operations_default_work_center_id_fkey"
            columns: ["default_work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturing_order_outputs: {
        Row: {
          condition: string
          cost_allocation_percent: number | null
          created_at: string
          created_stock_package_id: string | null
          id: string
          manufacturing_order_id: string
          operation_id: string | null
          output_type: string
          product_id: string
          qty_done: number
          qty_expected: number
          stock_location_id: string | null
          uom_id: string | null
          updated_at: string
        }
        Insert: {
          condition?: string
          cost_allocation_percent?: number | null
          created_at?: string
          created_stock_package_id?: string | null
          id?: string
          manufacturing_order_id: string
          operation_id?: string | null
          output_type: string
          product_id: string
          qty_done?: number
          qty_expected?: number
          stock_location_id?: string | null
          uom_id?: string | null
          updated_at?: string
        }
        Update: {
          condition?: string
          cost_allocation_percent?: number | null
          created_at?: string
          created_stock_package_id?: string | null
          id?: string
          manufacturing_order_id?: string
          operation_id?: string | null
          output_type?: string
          product_id?: string
          qty_done?: number
          qty_expected?: number
          stock_location_id?: string | null
          uom_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_order_outputs_manufacturing_order_id_fkey"
            columns: ["manufacturing_order_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_order_outputs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "manufacturing_order_outputs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_order_outputs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "manufacturing_order_outputs_stock_location_id_fkey"
            columns: ["stock_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_order_outputs_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "product_uom"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturing_orders: {
        Row: {
          actual_end: string | null
          actual_start: string | null
          blocked_reason: string | null
          bom_depth: number
          bom_id: string | null
          code: string
          created_at: string
          created_by: string | null
          due_date: string | null
          expected_finish_date: string | null
          id: string
          labor_cost: number
          material_cost: number
          notes: string | null
          origin: Database["public"]["Enums"]["mo_origin"]
          parent_mo_component_id: string | null
          parent_mo_id: string | null
          partner_id: string | null
          planned_end: string | null
          planned_start: string | null
          priority: Database["public"]["Enums"]["mo_priority"]
          product_id: string
          qty: number
          responsible_id: string | null
          root_mo_id: string | null
          root_sale_order_id: string | null
          root_sale_order_line_id: string | null
          sale_order_id: string | null
          sale_order_line_id: string | null
          service_case_id: string | null
          service_case_item_id: string | null
          state: Database["public"]["Enums"]["mo_state"]
          total_cost: number
          unit_cost: number
          uom_id: string | null
          updated_at: string
          variant_id: string | null
          warehouse_id: string | null
        }
        Insert: {
          actual_end?: string | null
          actual_start?: string | null
          blocked_reason?: string | null
          bom_depth?: number
          bom_id?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          expected_finish_date?: string | null
          id?: string
          labor_cost?: number
          material_cost?: number
          notes?: string | null
          origin?: Database["public"]["Enums"]["mo_origin"]
          parent_mo_component_id?: string | null
          parent_mo_id?: string | null
          partner_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          priority?: Database["public"]["Enums"]["mo_priority"]
          product_id: string
          qty: number
          responsible_id?: string | null
          root_mo_id?: string | null
          root_sale_order_id?: string | null
          root_sale_order_line_id?: string | null
          sale_order_id?: string | null
          sale_order_line_id?: string | null
          service_case_id?: string | null
          service_case_item_id?: string | null
          state?: Database["public"]["Enums"]["mo_state"]
          total_cost?: number
          unit_cost?: number
          uom_id?: string | null
          updated_at?: string
          variant_id?: string | null
          warehouse_id?: string | null
        }
        Update: {
          actual_end?: string | null
          actual_start?: string | null
          blocked_reason?: string | null
          bom_depth?: number
          bom_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          expected_finish_date?: string | null
          id?: string
          labor_cost?: number
          material_cost?: number
          notes?: string | null
          origin?: Database["public"]["Enums"]["mo_origin"]
          parent_mo_component_id?: string | null
          parent_mo_id?: string | null
          partner_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          priority?: Database["public"]["Enums"]["mo_priority"]
          product_id?: string
          qty?: number
          responsible_id?: string | null
          root_mo_id?: string | null
          root_sale_order_id?: string | null
          root_sale_order_line_id?: string | null
          sale_order_id?: string | null
          sale_order_line_id?: string | null
          service_case_id?: string | null
          service_case_item_id?: string | null
          state?: Database["public"]["Enums"]["mo_state"]
          total_cost?: number
          unit_cost?: number
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
            foreignKeyName: "manufacturing_orders_parent_mo_component_id_fkey"
            columns: ["parent_mo_component_id"]
            isOneToOne: false
            referencedRelation: "mo_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_orders_parent_mo_id_fkey"
            columns: ["parent_mo_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
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
            foreignKeyName: "manufacturing_orders_root_mo_id_fkey"
            columns: ["root_mo_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
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
            foreignKeyName: "manufacturing_orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "manufacturing_orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "manufacturing_orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "manufacturing_orders_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_orders_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_line_id"]
          },
          {
            foreignKeyName: "manufacturing_orders_service_case_id_fkey"
            columns: ["service_case_id"]
            isOneToOne: false
            referencedRelation: "service_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_orders_service_case_item_id_fkey"
            columns: ["service_case_item_id"]
            isOneToOne: false
            referencedRelation: "service_case_items"
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
      manufacturing_routing_operations: {
        Row: {
          active: boolean
          cleanup_time_minutes: number
          created_at: string
          default_duration_minutes: number | null
          id: string
          instructions: string | null
          operation_id: string
          requires_quality_check: boolean
          routing_id: string
          sequence: number
          setup_time_minutes: number
          updated_at: string
          work_center_id: string | null
        }
        Insert: {
          active?: boolean
          cleanup_time_minutes?: number
          created_at?: string
          default_duration_minutes?: number | null
          id?: string
          instructions?: string | null
          operation_id: string
          requires_quality_check?: boolean
          routing_id: string
          sequence: number
          setup_time_minutes?: number
          updated_at?: string
          work_center_id?: string | null
        }
        Update: {
          active?: boolean
          cleanup_time_minutes?: number
          created_at?: string
          default_duration_minutes?: number | null
          id?: string
          instructions?: string | null
          operation_id?: string
          requires_quality_check?: boolean
          routing_id?: string
          sequence?: number
          setup_time_minutes?: number
          updated_at?: string
          work_center_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_routing_operations_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_routing_operations_routing_id_fkey"
            columns: ["routing_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_routings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_routing_operations_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturing_routings: {
        Row: {
          active: boolean
          created_at: string
          id: string
          is_default: boolean
          name: string
          product_id: string
          updated_at: string
          variant_id: string | null
          version: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          product_id: string
          updated_at?: string
          variant_id?: string | null
          version?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          product_id?: string
          updated_at?: string
          variant_id?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_routings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "manufacturing_routings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_routings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
        ]
      }
      mo_components: {
        Row: {
          bom_line_id: string | null
          child_mo_id: string | null
          consumption_uom_id: string | null
          conversion_factor: number | null
          created_at: string
          formula: string | null
          id: string
          inheritance_action: string
          is_critical: boolean
          is_optional: boolean
          mo_id: string
          operation_id: string | null
          parent_bom_line_id: string | null
          product_id: string
          qty_available: number
          qty_consumed: number
          qty_required: number
          qty_reserved: number
          qty_to_manufacture: number
          qty_to_purchase: number
          rounding_method: string
          scrap_pct: number
          sequence: number
          status: Database["public"]["Enums"]["mo_component_status"]
          supply_method: string | null
          uom_id: string | null
          variant_id: string | null
          variant_rule_id: string | null
          work_center_id: string | null
        }
        Insert: {
          bom_line_id?: string | null
          child_mo_id?: string | null
          consumption_uom_id?: string | null
          conversion_factor?: number | null
          created_at?: string
          formula?: string | null
          id?: string
          inheritance_action?: string
          is_critical?: boolean
          is_optional?: boolean
          mo_id: string
          operation_id?: string | null
          parent_bom_line_id?: string | null
          product_id: string
          qty_available?: number
          qty_consumed?: number
          qty_required?: number
          qty_reserved?: number
          qty_to_manufacture?: number
          qty_to_purchase?: number
          rounding_method?: string
          scrap_pct?: number
          sequence?: number
          status?: Database["public"]["Enums"]["mo_component_status"]
          supply_method?: string | null
          uom_id?: string | null
          variant_id?: string | null
          variant_rule_id?: string | null
          work_center_id?: string | null
        }
        Update: {
          bom_line_id?: string | null
          child_mo_id?: string | null
          consumption_uom_id?: string | null
          conversion_factor?: number | null
          created_at?: string
          formula?: string | null
          id?: string
          inheritance_action?: string
          is_critical?: boolean
          is_optional?: boolean
          mo_id?: string
          operation_id?: string | null
          parent_bom_line_id?: string | null
          product_id?: string
          qty_available?: number
          qty_consumed?: number
          qty_required?: number
          qty_reserved?: number
          qty_to_manufacture?: number
          qty_to_purchase?: number
          rounding_method?: string
          scrap_pct?: number
          sequence?: number
          status?: Database["public"]["Enums"]["mo_component_status"]
          supply_method?: string | null
          uom_id?: string | null
          variant_id?: string | null
          variant_rule_id?: string | null
          work_center_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mo_components_bom_line_id_fkey"
            columns: ["bom_line_id"]
            isOneToOne: false
            referencedRelation: "bom_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mo_components_child_mo_id_fkey"
            columns: ["child_mo_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mo_components_consumption_uom_id_fkey"
            columns: ["consumption_uom_id"]
            isOneToOne: false
            referencedRelation: "product_uom"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mo_components_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mo_components_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mo_components_parent_bom_line_id_fkey"
            columns: ["parent_bom_line_id"]
            isOneToOne: false
            referencedRelation: "bom_lines"
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
          {
            foreignKeyName: "mo_components_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
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
          actual_duration_minutes: number | null
          actual_end_at: string | null
          actual_start_at: string | null
          assigned_employee_id: string | null
          block_reason: string | null
          created_at: string
          finished_at: string | null
          id: string
          is_qc: boolean
          is_rework: boolean
          machine_id: string | null
          mo_id: string
          name: string
          notes: string | null
          operation_id: string | null
          operator_id: string | null
          planned_end_at: string | null
          planned_minutes: number
          planned_start_at: string | null
          qty_done: number
          qty_scrap: number
          sequence: number
          started_at: string | null
          state: Database["public"]["Enums"]["mo_op_state"]
          updated_at: string
          work_center_id: string | null
          workcenter: string | null
        }
        Insert: {
          actual_duration_minutes?: number | null
          actual_end_at?: string | null
          actual_start_at?: string | null
          assigned_employee_id?: string | null
          block_reason?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          is_qc?: boolean
          is_rework?: boolean
          machine_id?: string | null
          mo_id: string
          name: string
          notes?: string | null
          operation_id?: string | null
          operator_id?: string | null
          planned_end_at?: string | null
          planned_minutes?: number
          planned_start_at?: string | null
          qty_done?: number
          qty_scrap?: number
          sequence?: number
          started_at?: string | null
          state?: Database["public"]["Enums"]["mo_op_state"]
          updated_at?: string
          work_center_id?: string | null
          workcenter?: string | null
        }
        Update: {
          actual_duration_minutes?: number | null
          actual_end_at?: string | null
          actual_start_at?: string | null
          assigned_employee_id?: string | null
          block_reason?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          is_qc?: boolean
          is_rework?: boolean
          machine_id?: string | null
          mo_id?: string
          name?: string
          notes?: string | null
          operation_id?: string | null
          operator_id?: string | null
          planned_end_at?: string | null
          planned_minutes?: number
          planned_start_at?: string | null
          qty_done?: number
          qty_scrap?: number
          sequence?: number
          started_at?: string | null
          state?: Database["public"]["Enums"]["mo_op_state"]
          updated_at?: string
          work_center_id?: string | null
          workcenter?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mo_operations_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mo_operations_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mo_operations_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mo_operations_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
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
          {
            foreignKeyName: "mo_workorder_logs_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
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
      notification_delivery_log: {
        Row: {
          attempted_at: string
          channel: string
          delivered_at: string | null
          error_message: string | null
          id: string
          notification_id: string
          status: string
        }
        Insert: {
          attempted_at?: string
          channel: string
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          notification_id: string
          status: string
        }
        Update: {
          attempted_at?: string
          channel?: string
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          notification_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_delivery_log_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          category: string
          channel: string
          created_at: string
          enabled: boolean
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          channel: string
          created_at?: string
          enabled?: boolean
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          channel?: string
          created_at?: string
          enabled?: boolean
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          action_url: string | null
          body: string | null
          category: string | null
          created_at: string
          dismissed_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          link: string | null
          metadata: Json
          module: Database["public"]["Enums"]["app_module"]
          payload: Json | null
          priority: string
          read_at: string | null
          recipient_group: string | null
          severity: string
          status: string
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          action_url?: string | null
          body?: string | null
          category?: string | null
          created_at?: string
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link?: string | null
          metadata?: Json
          module: Database["public"]["Enums"]["app_module"]
          payload?: Json | null
          priority?: string
          read_at?: string | null
          recipient_group?: string | null
          severity?: string
          status?: string
          title: string
          type: string
          user_id?: string | null
        }
        Update: {
          action_url?: string | null
          body?: string | null
          category?: string | null
          created_at?: string
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link?: string | null
          metadata?: Json
          module?: Database["public"]["Enums"]["app_module"]
          payload?: Json | null
          priority?: string
          read_at?: string | null
          recipient_group?: string | null
          severity?: string
          status?: string
          title?: string
          type?: string
          user_id?: string | null
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
      operation_employee_skills: {
        Row: {
          active: boolean
          can_execute: boolean
          created_at: string
          employee_id: string | null
          id: string
          operation_id: string
          skill_level: Database["public"]["Enums"]["mfg_skill_level"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          can_execute?: boolean
          created_at?: string
          employee_id?: string | null
          id?: string
          operation_id: string
          skill_level?: Database["public"]["Enums"]["mfg_skill_level"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          can_execute?: boolean
          created_at?: string
          employee_id?: string | null
          id?: string
          operation_id?: string
          skill_level?: Database["public"]["Enums"]["mfg_skill_level"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_employee_skills_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_operations"
            referencedColumns: ["id"]
          },
        ]
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
          return_condition: string | null
          route_id: string | null
          route_order_id: string | null
          sale_order_id: string | null
          sale_order_line_id: string | null
          service_case_id: string | null
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
          return_condition?: string | null
          route_id?: string | null
          route_order_id?: string | null
          sale_order_id?: string | null
          sale_order_line_id?: string | null
          service_case_id?: string | null
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
          return_condition?: string | null
          route_id?: string | null
          route_order_id?: string | null
          sale_order_id?: string | null
          sale_order_line_id?: string | null
          service_case_id?: string | null
          status?: Database["public"]["Enums"]["package_damage_status"]
          stock_package_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_damage_reports_route_order_id_fkey"
            columns: ["route_order_id"]
            isOneToOne: false
            referencedRelation: "delivery_route_orders"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "package_damage_reports_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_damage_reports_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "package_damage_reports_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "package_damage_reports_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "package_damage_reports_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_damage_reports_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_line_id"]
          },
          {
            foreignKeyName: "package_damage_reports_service_case_id_fkey"
            columns: ["service_case_id"]
            isOneToOne: false
            referencedRelation: "service_cases"
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
          default_expense_account_id: string | null
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
          default_expense_account_id?: string | null
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
          default_expense_account_id?: string | null
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
          {
            foreignKeyName: "partners_default_expense_account_id_fkey"
            columns: ["default_expense_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
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
          default_account_id: string | null
          default_journal_id: string | null
          feeds_cash_session: boolean
          id: string
          journal_type: string
          name: string
          provider_fee_fixed: number
          provider_fee_pct: number
          requires_reconciliation: boolean
          requires_reference: boolean
          settlement_delay_days: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          confirmation_mode?: string
          created_at?: string
          default_account_id?: string | null
          default_journal_id?: string | null
          feeds_cash_session?: boolean
          id?: string
          journal_type?: string
          name: string
          provider_fee_fixed?: number
          provider_fee_pct?: number
          requires_reconciliation?: boolean
          requires_reference?: boolean
          settlement_delay_days?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          confirmation_mode?: string
          created_at?: string
          default_account_id?: string | null
          default_journal_id?: string | null
          feeds_cash_session?: boolean
          id?: string
          journal_type?: string
          name?: string
          provider_fee_fixed?: number
          provider_fee_pct?: number
          requires_reconciliation?: boolean
          requires_reference?: boolean
          settlement_delay_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_default_account_id_fkey"
            columns: ["default_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
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
          allocation_policy: Database["public"]["Enums"]["allocation_policy"]
          allocation_priority_weights: Json | null
          assembly_fee: number
          assembly_minutes: number
          auto_purchase: boolean
          average_cost: number
          barcode: string | null
          can_be_manufactured: boolean
          can_be_purchased: boolean
          can_be_sold: boolean
          category_id: string | null
          company_id: string | null
          component_allocation_policy: Database["public"]["Enums"]["component_allocation_policy"]
          cost_updated_at: string | null
          created_at: string
          delivery_surcharge: number
          depth: number | null
          description: string | null
          gross_weight: number | null
          height: number | null
          id: string
          image_url: string | null
          internal_ref: string | null
          last_cost: number
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
          supply_priority: string | null
          supply_route:
            | Database["public"]["Enums"]["product_supply_route"]
            | null
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
          allocation_policy?: Database["public"]["Enums"]["allocation_policy"]
          allocation_priority_weights?: Json | null
          assembly_fee?: number
          assembly_minutes?: number
          auto_purchase?: boolean
          average_cost?: number
          barcode?: string | null
          can_be_manufactured?: boolean
          can_be_purchased?: boolean
          can_be_sold?: boolean
          category_id?: string | null
          company_id?: string | null
          component_allocation_policy?: Database["public"]["Enums"]["component_allocation_policy"]
          cost_updated_at?: string | null
          created_at?: string
          delivery_surcharge?: number
          depth?: number | null
          description?: string | null
          gross_weight?: number | null
          height?: number | null
          id?: string
          image_url?: string | null
          internal_ref?: string | null
          last_cost?: number
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
          supply_priority?: string | null
          supply_route?:
            | Database["public"]["Enums"]["product_supply_route"]
            | null
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
          allocation_policy?: Database["public"]["Enums"]["allocation_policy"]
          allocation_priority_weights?: Json | null
          assembly_fee?: number
          assembly_minutes?: number
          auto_purchase?: boolean
          average_cost?: number
          barcode?: string | null
          can_be_manufactured?: boolean
          can_be_purchased?: boolean
          can_be_sold?: boolean
          category_id?: string | null
          company_id?: string | null
          component_allocation_policy?: Database["public"]["Enums"]["component_allocation_policy"]
          cost_updated_at?: string | null
          created_at?: string
          delivery_surcharge?: number
          depth?: number | null
          description?: string | null
          gross_weight?: number | null
          height?: number | null
          id?: string
          image_url?: string | null
          internal_ref?: string | null
          last_cost?: number
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
          supply_priority?: string | null
          supply_route?:
            | Database["public"]["Enums"]["product_supply_route"]
            | null
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
          bom_line_id: string | null
          created_at: string
          created_by: string | null
          fulfillment_payload: Json | null
          id: string
          manufacturing_order_id: string | null
          mo_component_id: string | null
          needed_by: string | null
          notes: string | null
          origin_kind: Database["public"]["Enums"]["purchase_need_origin"]
          priority: number
          product_id: string
          product_variant_id: string | null
          purchase_order_id: string | null
          purchase_order_line_id: string | null
          purpose: string | null
          qty_needed: number
          sale_order_id: string | null
          sale_order_line_id: string | null
          satisfied_at: string | null
          satisfied_by: string | null
          satisfied_qty: number | null
          satisfied_source_id: string | null
          service_case_id: string | null
          service_case_item_id: string | null
          state: Database["public"]["Enums"]["purchase_need_state"]
          suggested_partner_id: string | null
          updated_at: string
        }
        Insert: {
          bom_line_id?: string | null
          created_at?: string
          created_by?: string | null
          fulfillment_payload?: Json | null
          id?: string
          manufacturing_order_id?: string | null
          mo_component_id?: string | null
          needed_by?: string | null
          notes?: string | null
          origin_kind: Database["public"]["Enums"]["purchase_need_origin"]
          priority?: number
          product_id: string
          product_variant_id?: string | null
          purchase_order_id?: string | null
          purchase_order_line_id?: string | null
          purpose?: string | null
          qty_needed: number
          sale_order_id?: string | null
          sale_order_line_id?: string | null
          satisfied_at?: string | null
          satisfied_by?: string | null
          satisfied_qty?: number | null
          satisfied_source_id?: string | null
          service_case_id?: string | null
          service_case_item_id?: string | null
          state?: Database["public"]["Enums"]["purchase_need_state"]
          suggested_partner_id?: string | null
          updated_at?: string
        }
        Update: {
          bom_line_id?: string | null
          created_at?: string
          created_by?: string | null
          fulfillment_payload?: Json | null
          id?: string
          manufacturing_order_id?: string | null
          mo_component_id?: string | null
          needed_by?: string | null
          notes?: string | null
          origin_kind?: Database["public"]["Enums"]["purchase_need_origin"]
          priority?: number
          product_id?: string
          product_variant_id?: string | null
          purchase_order_id?: string | null
          purchase_order_line_id?: string | null
          purpose?: string | null
          qty_needed?: number
          sale_order_id?: string | null
          sale_order_line_id?: string | null
          satisfied_at?: string | null
          satisfied_by?: string | null
          satisfied_qty?: number | null
          satisfied_source_id?: string | null
          service_case_id?: string | null
          service_case_item_id?: string | null
          state?: Database["public"]["Enums"]["purchase_need_state"]
          suggested_partner_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_needs_bom_line_id_fkey"
            columns: ["bom_line_id"]
            isOneToOne: false
            referencedRelation: "bom_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_needs_manufacturing_order_id_fkey"
            columns: ["manufacturing_order_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_needs_mo_component_id_fkey"
            columns: ["mo_component_id"]
            isOneToOne: false
            referencedRelation: "mo_components"
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
            foreignKeyName: "purchase_needs_purchase_order_line_id_fkey"
            columns: ["purchase_order_line_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_lines"
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
            foreignKeyName: "purchase_needs_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_needs_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "purchase_needs_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "purchase_needs_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "purchase_needs_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_needs_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_line_id"]
          },
          {
            foreignKeyName: "purchase_needs_service_case_id_fkey"
            columns: ["service_case_id"]
            isOneToOne: false
            referencedRelation: "service_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_needs_service_case_item_id_fkey"
            columns: ["service_case_item_id"]
            isOneToOne: false
            referencedRelation: "service_case_items"
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
            foreignKeyName: "purchase_order_lines_source_sale_order_id_fkey"
            columns: ["source_sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_source_sale_order_id_fkey"
            columns: ["source_sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "purchase_order_lines_source_sale_order_id_fkey"
            columns: ["source_sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "purchase_order_lines_source_sale_order_id_fkey"
            columns: ["source_sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
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
          {
            foreignKeyName: "purchase_order_origins_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_origins_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "purchase_order_origins_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "purchase_order_origins_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
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
      recurring_expenses: {
        Row: {
          account_id: string | null
          active: boolean
          amount: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          category: string
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          frequency: string
          id: string
          journal_id: string | null
          last_generated_bill_id: string | null
          last_generated_due_date: string | null
          name: string
          next_due_date: string
          notes: string | null
          payment_method_id: string | null
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          active?: boolean
          amount: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          frequency: string
          id?: string
          journal_id?: string | null
          last_generated_bill_id?: string | null
          last_generated_due_date?: string | null
          name: string
          next_due_date: string
          notes?: string | null
          payment_method_id?: string | null
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          active?: boolean
          amount?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          frequency?: string
          id?: string
          journal_id?: string | null
          last_generated_bill_id?: string | null
          last_generated_due_date?: string | null
          name?: string
          next_due_date?: string
          notes?: string | null
          payment_method_id?: string | null
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expenses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "account_journals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_last_generated_bill_id_fkey"
            columns: ["last_generated_bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
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
          {
            foreignKeyName: "sale_operational_plan_log_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_operational_plan_log_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_operational_plan_log_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_operational_plan_log_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
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
            foreignKeyName: "sale_order_line_supply_links_inherited_from_line_id_fkey"
            columns: ["inherited_from_line_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_line_id"]
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
            foreignKeyName: "sale_order_line_supply_links_origin_line_id_fkey"
            columns: ["origin_line_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_line_id"]
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
          {
            foreignKeyName: "sale_order_line_supply_links_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_line_id"]
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
            foreignKeyName: "sale_order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_order_lines_parent_line_id_fkey"
            columns: ["parent_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_lines_parent_line_id_fkey"
            columns: ["parent_line_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_line_id"]
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
            foreignKeyName: "sale_order_timeline_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_timeline_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_order_timeline_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_order_timeline_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_order_timeline_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_timeline_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_line_id"]
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
            foreignKeyName: "sale_orders_parent_sale_order_id_fkey"
            columns: ["parent_sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_parent_sale_order_id_fkey"
            columns: ["parent_sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_orders_parent_sale_order_id_fkey"
            columns: ["parent_sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_orders_parent_sale_order_id_fkey"
            columns: ["parent_sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
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
            foreignKeyName: "sale_orders_root_sale_order_id_fkey"
            columns: ["root_sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_root_sale_order_id_fkey"
            columns: ["root_sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_orders_root_sale_order_id_fkey"
            columns: ["root_sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_orders_root_sale_order_id_fkey"
            columns: ["root_sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
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
          {
            foreignKeyName: "sale_payment_schedules_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_payment_schedules_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_payment_schedules_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_payment_schedules_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
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
            foreignKeyName: "sale_split_payment_allocations_deferred_order_id_fkey"
            columns: ["deferred_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_split_payment_allocations_deferred_order_id_fkey"
            columns: ["deferred_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_split_payment_allocations_deferred_order_id_fkey"
            columns: ["deferred_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_split_payment_allocations_deferred_order_id_fkey"
            columns: ["deferred_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
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
          {
            foreignKeyName: "sale_split_payment_allocations_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_split_payment_allocations_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_split_payment_allocations_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_split_payment_allocations_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
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
      service_case_attachments: {
        Row: {
          attachment_type: Database["public"]["Enums"]["service_case_attachment_type"]
          created_at: string
          file_name: string | null
          file_type: string | null
          file_url: string | null
          id: string
          service_case_id: string
          uploaded_by: string | null
        }
        Insert: {
          attachment_type?: Database["public"]["Enums"]["service_case_attachment_type"]
          created_at?: string
          file_name?: string | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          service_case_id: string
          uploaded_by?: string | null
        }
        Update: {
          attachment_type?: Database["public"]["Enums"]["service_case_attachment_type"]
          created_at?: string
          file_name?: string | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          service_case_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_case_attachments_service_case_id_fkey"
            columns: ["service_case_id"]
            isOneToOne: false
            referencedRelation: "service_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      service_case_charges: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          customer_credit_id: string | null
          customer_payment_id: string | null
          id: string
          kind: string
          notes: string | null
          partner_id: string
          service_case_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          customer_credit_id?: string | null
          customer_payment_id?: string | null
          id?: string
          kind: string
          notes?: string | null
          partner_id: string
          service_case_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          customer_credit_id?: string | null
          customer_payment_id?: string | null
          id?: string
          kind?: string
          notes?: string | null
          partner_id?: string
          service_case_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_case_charges_customer_credit_id_fkey"
            columns: ["customer_credit_id"]
            isOneToOne: false
            referencedRelation: "customer_credits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_case_charges_customer_payment_id_fkey"
            columns: ["customer_payment_id"]
            isOneToOne: false
            referencedRelation: "bnpl_pending_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_case_charges_customer_payment_id_fkey"
            columns: ["customer_payment_id"]
            isOneToOne: false
            referencedRelation: "customer_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_case_charges_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_case_charges_service_case_id_fkey"
            columns: ["service_case_id"]
            isOneToOne: false
            referencedRelation: "service_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      service_case_costs: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          kind: string
          notes: string | null
          quantity: number
          service_case_id: string
          supplier_id: string | null
          total_cost: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          kind: string
          notes?: string | null
          quantity?: number
          service_case_id: string
          supplier_id?: string | null
          total_cost: number
          unit_cost?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          kind?: string
          notes?: string | null
          quantity?: number
          service_case_id?: string
          supplier_id?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_case_costs_service_case_id_fkey"
            columns: ["service_case_id"]
            isOneToOne: false
            referencedRelation: "service_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_case_costs_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      service_case_items: {
        Row: {
          created_at: string
          id: string
          issue_type: Database["public"]["Enums"]["service_case_item_issue_type"]
          notes: string | null
          product_id: string | null
          product_variant_id: string | null
          qty: number
          qty_ready: number
          qty_reserved: number
          repair_completed_at: string | null
          repair_notes: string | null
          repair_result: string | null
          repair_started_at: string | null
          repair_status: string | null
          required_action:
            | Database["public"]["Enums"]["service_case_item_action"]
            | null
          sale_order_line_id: string | null
          service_case_id: string
          status: Database["public"]["Enums"]["service_case_item_status"]
          stock_package_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          issue_type?: Database["public"]["Enums"]["service_case_item_issue_type"]
          notes?: string | null
          product_id?: string | null
          product_variant_id?: string | null
          qty?: number
          qty_ready?: number
          qty_reserved?: number
          repair_completed_at?: string | null
          repair_notes?: string | null
          repair_result?: string | null
          repair_started_at?: string | null
          repair_status?: string | null
          required_action?:
            | Database["public"]["Enums"]["service_case_item_action"]
            | null
          sale_order_line_id?: string | null
          service_case_id: string
          status?: Database["public"]["Enums"]["service_case_item_status"]
          stock_package_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          issue_type?: Database["public"]["Enums"]["service_case_item_issue_type"]
          notes?: string | null
          product_id?: string | null
          product_variant_id?: string | null
          qty?: number
          qty_ready?: number
          qty_reserved?: number
          repair_completed_at?: string | null
          repair_notes?: string | null
          repair_result?: string | null
          repair_started_at?: string | null
          repair_status?: string | null
          required_action?:
            | Database["public"]["Enums"]["service_case_item_action"]
            | null
          sale_order_line_id?: string | null
          service_case_id?: string
          status?: Database["public"]["Enums"]["service_case_item_status"]
          stock_package_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_case_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "service_case_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_case_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "service_case_items_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_case_items_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_line_id"]
          },
          {
            foreignKeyName: "service_case_items_service_case_id_fkey"
            columns: ["service_case_id"]
            isOneToOne: false
            referencedRelation: "service_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_case_items_stock_package_id_fkey"
            columns: ["stock_package_id"]
            isOneToOne: false
            referencedRelation: "stock_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      service_cases: {
        Row: {
          assigned_to: string | null
          case_number: string
          case_type: Database["public"]["Enums"]["service_case_type"]
          closed_at: string | null
          closed_resolution: string | null
          created_at: string
          customer_id: string | null
          customer_notes: string | null
          delivery_route_order_id: string | null
          delivery_schedule_id: string | null
          description: string | null
          id: string
          internal_notes: string | null
          priority: Database["public"]["Enums"]["service_case_priority"]
          product_id: string | null
          product_variant_id: string | null
          reported_at: string
          reported_by: string | null
          responsibility: Database["public"]["Enums"]["service_case_responsibility"]
          sale_order_id: string | null
          sale_order_line_id: string | null
          source: Database["public"]["Enums"]["service_case_source"]
          status: Database["public"]["Enums"]["service_case_status"]
          stock_package_id: string | null
          updated_at: string
          warranty_status: Database["public"]["Enums"]["service_case_warranty_status"]
        }
        Insert: {
          assigned_to?: string | null
          case_number: string
          case_type?: Database["public"]["Enums"]["service_case_type"]
          closed_at?: string | null
          closed_resolution?: string | null
          created_at?: string
          customer_id?: string | null
          customer_notes?: string | null
          delivery_route_order_id?: string | null
          delivery_schedule_id?: string | null
          description?: string | null
          id?: string
          internal_notes?: string | null
          priority?: Database["public"]["Enums"]["service_case_priority"]
          product_id?: string | null
          product_variant_id?: string | null
          reported_at?: string
          reported_by?: string | null
          responsibility?: Database["public"]["Enums"]["service_case_responsibility"]
          sale_order_id?: string | null
          sale_order_line_id?: string | null
          source?: Database["public"]["Enums"]["service_case_source"]
          status?: Database["public"]["Enums"]["service_case_status"]
          stock_package_id?: string | null
          updated_at?: string
          warranty_status?: Database["public"]["Enums"]["service_case_warranty_status"]
        }
        Update: {
          assigned_to?: string | null
          case_number?: string
          case_type?: Database["public"]["Enums"]["service_case_type"]
          closed_at?: string | null
          closed_resolution?: string | null
          created_at?: string
          customer_id?: string | null
          customer_notes?: string | null
          delivery_route_order_id?: string | null
          delivery_schedule_id?: string | null
          description?: string | null
          id?: string
          internal_notes?: string | null
          priority?: Database["public"]["Enums"]["service_case_priority"]
          product_id?: string | null
          product_variant_id?: string | null
          reported_at?: string
          reported_by?: string | null
          responsibility?: Database["public"]["Enums"]["service_case_responsibility"]
          sale_order_id?: string | null
          sale_order_line_id?: string | null
          source?: Database["public"]["Enums"]["service_case_source"]
          status?: Database["public"]["Enums"]["service_case_status"]
          stock_package_id?: string | null
          updated_at?: string
          warranty_status?: Database["public"]["Enums"]["service_case_warranty_status"]
        }
        Relationships: [
          {
            foreignKeyName: "service_cases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_cases_delivery_route_order_id_fkey"
            columns: ["delivery_route_order_id"]
            isOneToOne: false
            referencedRelation: "delivery_route_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_cases_delivery_schedule_id_fkey"
            columns: ["delivery_schedule_id"]
            isOneToOne: false
            referencedRelation: "delivery_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_cases_delivery_schedule_id_fkey"
            columns: ["delivery_schedule_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["schedule_id"]
          },
          {
            foreignKeyName: "service_cases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "service_cases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_cases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "service_cases_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_fulfillment"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "service_cases_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_cases_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_cases_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "service_cases_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "service_cases_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "service_cases_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_cases_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_line_id"]
          },
          {
            foreignKeyName: "service_cases_stock_package_id_fkey"
            columns: ["stock_package_id"]
            isOneToOne: false
            referencedRelation: "stock_packages"
            referencedColumns: ["id"]
          },
        ]
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
      service_tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          due_date: string | null
          id: string
          linked_delivery_schedule_id: string | null
          linked_manufacturing_order_id: string | null
          linked_purchase_need_id: string | null
          notes: string | null
          service_case_id: string
          service_case_item_id: string | null
          status: Database["public"]["Enums"]["service_task_status"]
          task_type: Database["public"]["Enums"]["service_task_type"]
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          linked_delivery_schedule_id?: string | null
          linked_manufacturing_order_id?: string | null
          linked_purchase_need_id?: string | null
          notes?: string | null
          service_case_id: string
          service_case_item_id?: string | null
          status?: Database["public"]["Enums"]["service_task_status"]
          task_type: Database["public"]["Enums"]["service_task_type"]
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          linked_delivery_schedule_id?: string | null
          linked_manufacturing_order_id?: string | null
          linked_purchase_need_id?: string | null
          notes?: string | null
          service_case_id?: string
          service_case_item_id?: string | null
          status?: Database["public"]["Enums"]["service_task_status"]
          task_type?: Database["public"]["Enums"]["service_task_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_tasks_linked_delivery_schedule_id_fkey"
            columns: ["linked_delivery_schedule_id"]
            isOneToOne: false
            referencedRelation: "delivery_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_tasks_linked_delivery_schedule_id_fkey"
            columns: ["linked_delivery_schedule_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["schedule_id"]
          },
          {
            foreignKeyName: "service_tasks_linked_manufacturing_order_id_fkey"
            columns: ["linked_manufacturing_order_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_tasks_linked_purchase_need_id_fkey"
            columns: ["linked_purchase_need_id"]
            isOneToOne: false
            referencedRelation: "purchase_needs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_tasks_service_case_id_fkey"
            columns: ["service_case_id"]
            isOneToOne: false
            referencedRelation: "service_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_tasks_service_case_item_id_fkey"
            columns: ["service_case_item_id"]
            isOneToOne: false
            referencedRelation: "service_case_items"
            referencedColumns: ["id"]
          },
        ]
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
          mo_component_id: string | null
          package_id: string | null
          picking_id: string | null
          product_id: string
          purchase_need_id: string | null
          purchase_order_line_id: string | null
          quantity: number
          quantity_done: number
          reference: string | null
          reserved_quantity: number
          source_location_id: string
          state: Database["public"]["Enums"]["picking_state"]
          unit_cost: number | null
          uom_id: string | null
          variant_id: string | null
          wave_id: string | null
        }
        Insert: {
          created_at?: string
          destination_location_id: string
          id?: string
          lot_id?: string | null
          mo_component_id?: string | null
          package_id?: string | null
          picking_id?: string | null
          product_id: string
          purchase_need_id?: string | null
          purchase_order_line_id?: string | null
          quantity?: number
          quantity_done?: number
          reference?: string | null
          reserved_quantity?: number
          source_location_id: string
          state?: Database["public"]["Enums"]["picking_state"]
          unit_cost?: number | null
          uom_id?: string | null
          variant_id?: string | null
          wave_id?: string | null
        }
        Update: {
          created_at?: string
          destination_location_id?: string
          id?: string
          lot_id?: string | null
          mo_component_id?: string | null
          package_id?: string | null
          picking_id?: string | null
          product_id?: string
          purchase_need_id?: string | null
          purchase_order_line_id?: string | null
          quantity?: number
          quantity_done?: number
          reference?: string | null
          reserved_quantity?: number
          source_location_id?: string
          state?: Database["public"]["Enums"]["picking_state"]
          unit_cost?: number | null
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
            foreignKeyName: "stock_moves_mo_component_id_fkey"
            columns: ["mo_component_id"]
            isOneToOne: false
            referencedRelation: "mo_components"
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
            foreignKeyName: "stock_moves_purchase_need_id_fkey"
            columns: ["purchase_need_id"]
            isOneToOne: false
            referencedRelation: "purchase_needs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_purchase_order_line_id_fkey"
            columns: ["purchase_order_line_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_lines"
            referencedColumns: ["id"]
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
          disposition_status: string | null
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
          service_case_id: string | null
          service_case_item_id: string | null
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
          disposition_status?: string | null
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
          service_case_id?: string | null
          service_case_item_id?: string | null
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
          disposition_status?: string | null
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
          service_case_id?: string | null
          service_case_item_id?: string | null
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
            foreignKeyName: "stock_packages_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_packages_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "stock_packages_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "stock_packages_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_margin"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "stock_packages_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "sale_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_packages_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_line_id"]
          },
          {
            foreignKeyName: "stock_packages_service_case_id_fkey"
            columns: ["service_case_id"]
            isOneToOne: false
            referencedRelation: "service_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_packages_service_case_item_id_fkey"
            columns: ["service_case_item_id"]
            isOneToOne: false
            referencedRelation: "service_case_items"
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
          from_sale_order_line_id: string | null
          id: string
          location_id: string | null
          lot_id: string | null
          notes: string | null
          origin_id: string | null
          origin_type: string
          package_ids: string[] | null
          payload: Json | null
          product_id: string
          qty: number
          qty_after: number | null
          qty_before: number | null
          reserved_by: string | null
          to_manufacturing_order_id: string | null
          to_mo_component_id: string | null
          to_sale_order_line_id: string | null
          to_service_case_id: string | null
          to_service_case_item_id: string | null
          variant_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          from_sale_order_line_id?: string | null
          id?: string
          location_id?: string | null
          lot_id?: string | null
          notes?: string | null
          origin_id?: string | null
          origin_type: string
          package_ids?: string[] | null
          payload?: Json | null
          product_id: string
          qty: number
          qty_after?: number | null
          qty_before?: number | null
          reserved_by?: string | null
          to_manufacturing_order_id?: string | null
          to_mo_component_id?: string | null
          to_sale_order_line_id?: string | null
          to_service_case_id?: string | null
          to_service_case_item_id?: string | null
          variant_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          from_sale_order_line_id?: string | null
          id?: string
          location_id?: string | null
          lot_id?: string | null
          notes?: string | null
          origin_id?: string | null
          origin_type?: string
          package_ids?: string[] | null
          payload?: Json | null
          product_id?: string
          qty?: number
          qty_after?: number | null
          qty_before?: number | null
          reserved_by?: string | null
          to_manufacturing_order_id?: string | null
          to_mo_component_id?: string | null
          to_sale_order_line_id?: string | null
          to_service_case_id?: string | null
          to_service_case_item_id?: string | null
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
          default_cost_center_id: string | null
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
          default_cost_center_id?: string | null
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
          default_cost_center_id?: string | null
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
            foreignKeyName: "stores_default_cost_center_id_fkey"
            columns: ["default_cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
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
      supplier_bill_lines: {
        Row: {
          bill_id: string
          created_at: string
          description: string | null
          id: string
          po_line_id: string | null
          product_id: string | null
          quantity: number
          subtotal: number
          tax_pct: number
          unit_price: number
        }
        Insert: {
          bill_id: string
          created_at?: string
          description?: string | null
          id?: string
          po_line_id?: string | null
          product_id?: string | null
          quantity: number
          subtotal?: number
          tax_pct?: number
          unit_price?: number
        }
        Update: {
          bill_id?: string
          created_at?: string
          description?: string | null
          id?: string
          po_line_id?: string | null
          product_id?: string | null
          quantity?: number
          subtotal?: number
          tax_pct?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bill_lines_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "supplier_bill_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_full"
            referencedColumns: ["product_id"]
          },
        ]
      }
      supplier_bills: {
        Row: {
          account_id: string | null
          amount_paid: number
          amount_total: number
          attachments: Json
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
          recurring_expense_id: string | null
          reference: string | null
          source: string
          state: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount_paid?: number
          amount_total?: number
          attachments?: Json
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
          recurring_expense_id?: string | null
          reference?: string | null
          source?: string
          state?: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount_paid?: number
          amount_total?: number
          attachments?: Json
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
          recurring_expense_id?: string | null
          reference?: string | null
          source?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bills_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bills_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bills_recurring_expense_id_fkey"
            columns: ["recurring_expense_id"]
            isOneToOne: false
            referencedRelation: "recurring_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          account_id: string | null
          amount: number
          attachments: Json
          bill_id: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string | null
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
          account_id?: string | null
          amount: number
          attachments?: Json
          bill_id?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
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
          account_id?: string | null
          amount?: number
          attachments?: Json
          bill_id?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
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
            foreignKeyName: "supplier_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
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
      user_list_views: {
        Row: {
          columns: Json
          created_at: string
          filters: Json
          id: string
          is_default: boolean
          name: string
          sort: Json
          updated_at: string
          user_id: string
          view_key: string
        }
        Insert: {
          columns?: Json
          created_at?: string
          filters?: Json
          id?: string
          is_default?: boolean
          name: string
          sort?: Json
          updated_at?: string
          user_id: string
          view_key: string
        }
        Update: {
          columns?: Json
          created_at?: string
          filters?: Json
          id?: string
          is_default?: boolean
          name?: string
          sort?: Json
          updated_at?: string
          user_id?: string
          view_key?: string
        }
        Relationships: []
      }
      user_store_assignments: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean
          removed_at: string | null
          removed_by: string | null
          removed_reason: string | null
          role: string
          store_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
          role?: string
          store_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
          role?: string
          store_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_store_assignments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
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
            foreignKeyName: "vehicle_route_manifest_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_line_id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "delivery_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["schedule_id"]
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
      work_center_employees: {
        Row: {
          active: boolean
          created_at: string
          employee_id: string | null
          id: string
          role: string | null
          skill_level: Database["public"]["Enums"]["mfg_skill_level"]
          updated_at: string
          user_id: string | null
          work_center_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          employee_id?: string | null
          id?: string
          role?: string | null
          skill_level?: Database["public"]["Enums"]["mfg_skill_level"]
          updated_at?: string
          user_id?: string | null
          work_center_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          employee_id?: string | null
          id?: string
          role?: string | null
          skill_level?: Database["public"]["Enums"]["mfg_skill_level"]
          updated_at?: string
          user_id?: string | null
          work_center_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_center_employees_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      work_centers: {
        Row: {
          active: boolean
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          capacity_per_day: number | null
          code: string
          company_id: string | null
          cost_per_hour: number | null
          created_at: string
          efficiency_percent: number
          id: string
          name: string
          notes: string | null
          type: Database["public"]["Enums"]["work_center_type"]
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          active?: boolean
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          capacity_per_day?: number | null
          code: string
          company_id?: string | null
          cost_per_hour?: number | null
          created_at?: string
          efficiency_percent?: number
          id?: string
          name: string
          notes?: string | null
          type?: Database["public"]["Enums"]["work_center_type"]
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          active?: boolean
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          capacity_per_day?: number | null
          code?: string
          company_id?: string | null
          cost_per_hour?: number | null
          created_at?: string
          efficiency_percent?: number
          id?: string
          name?: string
          notes?: string | null
          type?: Database["public"]["Enums"]["work_center_type"]
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_centers_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "product_stock_forecast"
            referencedColumns: ["warehouse_id"]
          },
          {
            foreignKeyName: "work_centers_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      bnpl_pending_settlements: {
        Row: {
          amount_gross: number | null
          amount_net: number | null
          cliente: string | null
          expected_settlement_date: string | null
          fee_amount: number | null
          id: string | null
          metodo: string | null
          metodo_code: string | null
          name: string | null
          payment_date: string | null
          reconciled_at: string | null
          state: string | null
          venda: string | null
        }
        Relationships: []
      }
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
      sale_orders_with_schedule_summary: {
        Row: {
          amount_total: number | null
          commitment_date: string | null
          date_order: string | null
          delivery_mode: string | null
          delivery_zone_label: string | null
          fulfillment_status: string | null
          id: string | null
          include_assembly: boolean | null
          include_delivery: boolean | null
          invoice_status: string | null
          name: string | null
          operational_status: string | null
          partner_id: string | null
          payment_status: string | null
          route_date: string | null
          route_id: string | null
          route_type: string | null
          sale_order_id: string | null
          schedule_confirmed: boolean | null
          schedule_id: string | null
          schedule_status: string | null
          scheduled_date: string | null
          slot_end: string | null
          slot_start: string | null
          state: Database["public"]["Enums"]["sale_state"] | null
          store_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_schedules_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "delivery_routes"
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
            foreignKeyName: "sale_orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
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
            foreignKeyName: "vehicle_route_manifest_sale_order_line_id_fkey"
            columns: ["sale_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_sale_line_allocation_demand"
            referencedColumns: ["sale_order_line_id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "delivery_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_route_manifest_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "sale_orders_with_schedule_summary"
            referencedColumns: ["schedule_id"]
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
      v_sale_line_allocation_demand: {
        Row: {
          created_at: string | null
          customer_id: string | null
          expected_delivery_date: string | null
          operational_status: string | null
          paid_amount: number | null
          product_id: string | null
          qty_delivered: number | null
          qty_missing: number | null
          qty_ordered: number | null
          qty_reserved: number | null
          qty_split_out: number | null
          sale_order_id: string | null
          sale_order_line_id: string | null
          sale_order_state: Database["public"]["Enums"]["sale_state"] | null
          variant_id: string | null
        }
        Relationships: [
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
            foreignKeyName: "sale_order_lines_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_partner_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      v_sale_margin: {
        Row: {
          cogs: number | null
          delivered_at: string | null
          margin_pct: number | null
          margin_value: number | null
          partner_id: string | null
          partner_name: string | null
          revenue: number | null
          sale_order_id: string | null
          sale_order_name: string | null
          sale_state: string | null
          salesperson_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_orders_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      __test_phase16_b0_3_impl: { Args: never; Returns: Json }
      _alloc_hook_is_package_eligible: {
        Args: { _package_id: string }
        Returns: boolean
      }
      _alloc_hook_is_safe_location: {
        Args: { _location_id: string }
        Returns: boolean
      }
      _alloc_hook_mark_failed: {
        Args: {
          _context: string
          _event_type: string
          _source_event_id: string
          _sqlerrm: string
          _sqlstate: string
        }
        Returns: undefined
      }
      _alloc_hook_register_event: {
        Args: {
          _event_type: string
          _location_id: string
          _product_id: string
          _qty: number
          _source_event_id: string
          _source_id: string
          _variant_id: string
        }
        Returns: boolean
      }
      _apply_cost_update: {
        Args: {
          _origin_id: string
          _origin_ref: string
          _origin_type: string
          _product: string
          _qty: number
          _unit_cost: number
          _variant: string
        }
        Returns: Json
      }
      _cleanup_golden_upm: { Args: never; Returns: undefined }
      _cleanup_phase17_payment_subcases: { Args: never; Returns: undefined }
      _cleanup_phase18_service_flow: { Args: never; Returns: undefined }
      _ensure_route_order: {
        Args: { _route: string; _schedule: string }
        Returns: string
      }
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
      _mfg_assert_finish_ok: { Args: { _op: string }; Returns: undefined }
      _mfg_assert_sequence_ok: {
        Args: { _op: string; _override_reason?: string }
        Returns: undefined
      }
      _mfg_assert_start_ok: { Args: { _op: string }; Returns: undefined }
      _mfg_materialize_child_components: {
        Args: { _mo: string }
        Returns: undefined
      }
      _phase17_diag_seed: { Args: never; Returns: Json }
      _phase17_diag_spine: { Args: never; Returns: Json }
      _portal_generate_token: { Args: never; Returns: string }
      _portal_hash_token: { Args: { _token: string }; Returns: string }
      _portal_is_agent: { Args: { _uid: string }; Returns: boolean }
      _portal_public_case_status: { Args: { _status: string }; Returns: string }
      _portal_public_order_status: {
        Args: { _fulfillment: string; _op_status: string; _state: string }
        Returns: string
      }
      _portal_resolve_token: {
        Args: { _required_scope?: string; _token: string }
        Returns: {
          created_at: string
          created_by: string | null
          customer_id: string
          expires_at: string
          id: string
          revoked_at: string | null
          sale_order_id: string | null
          scope: string
          service_case_id: string | null
          status: string
          token_hash: string
          used_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customer_portal_tokens"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _seed_golden_upm: { Args: never; Returns: Json }
      _service_log: {
        Args: { _case_id: string; _payload: Json; _ref: string; _step: string }
        Returns: undefined
      }
      _service_reserve_quant:
        | {
            Args: {
              _case: string
              _item: string
              _location: string
              _origin: string
              _origin_type: string
              _product: string
              _qty: number
              _variant: string
            }
            Returns: undefined
          }
        | {
            Args: {
              _case: string
              _item: string
              _location: string
              _origin: string
              _origin_type: string
              _payload?: Json
              _product: string
              _qty: number
              _variant: string
            }
            Returns: undefined
          }
      _sf_assert: {
        Args: { _arr: Json; _name: string; _obs: string; _ok: boolean }
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
      _svc_pkg_quant_relocate: {
        Args: { _package_id: string; _to_location: string }
        Returns: undefined
      }
      _svc_repair_loc: { Args: { _name: string }; Returns: string }
      _test_costing_mfg: { Args: never; Returns: Json }
      _test_costing_purchase: { Args: never; Returns: Json }
      _test_delivery_cash_fixes: { Args: never; Returns: Json }
      _test_f24_chat_dock_discuss_bridge: { Args: never; Returns: Json }
      _test_inventory_allocation_policy: { Args: never; Returns: Json }
      _test_inventory_allocation_policy_impl: {
        Args: { v_prefix: string }
        Returns: Json
      }
      _test_mfg_fixes: { Args: never; Returns: Json }
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
      _test_phase15_m5_safe: { Args: never; Returns: Json }
      _test_phase16_b_schema: { Args: never; Returns: Json }
      _test_phase16_b0_2_readonly: { Args: never; Returns: Json }
      _test_phase16_b0_3_allocation_engine: { Args: never; Returns: Json }
      _test_phase16_b0_4_close_mo_finished_reservation: {
        Args: never
        Returns: Json
      }
      _test_phase16_b0_5_cancel_allocation_policy: {
        Args: never
        Returns: Json
      }
      _test_phase16_b0_6_allocation_hooks: { Args: never; Returns: Json }
      _test_phase16_c1_bom_resolution_readonly: {
        Args: never
        Returns: {
          detail: string
          passed: boolean
          test_name: string
        }[]
      }
      _test_phase16_c2_mo_materialization: {
        Args: never
        Returns: {
          detail: string
          passed: boolean
          test_name: string
        }[]
      }
      _test_phase16_c3_component_purchase_reservation: {
        Args: never
        Returns: {
          detail: string
          passed: boolean
          test_name: string
        }[]
      }
      _test_phase16_c3_make_incoming_done: {
        Args: {
          _dst: string
          _need?: string
          _po_line?: string
          _product: string
          _qty: number
          _ref?: string
          _src: string
        }
        Returns: string
      }
      _test_phase16_c4_close_mo_outputs: {
        Args: never
        Returns: {
          detail: string
          passed: boolean
          test_name: string
        }[]
      }
      _test_phase16_component_variant_flow: {
        Args: never
        Returns: {
          detail: string
          passed: boolean
          scenario: string
        }[]
      }
      _test_phase16_multilevel_bom_subassembly: {
        Args: never
        Returns: {
          detail: string
          passed: boolean
          scenario: string
        }[]
      }
      _test_phase16_shopfloor_workorders: { Args: never; Returns: Json }
      _test_phase17_golden_flow: { Args: { _cleanup?: boolean }; Returns: Json }
      _test_phase17_payment_subcases: {
        Args: { _cleanup?: boolean }
        Returns: Json
      }
      _test_phase18_repair_disposition_flow: {
        Args: { _cleanup?: boolean }
        Returns: Json
      }
      _test_phase18_service_assistance_flow: {
        Args: { _cleanup?: boolean }
        Returns: Json
      }
      _test_phase19_customer_portal_helpdesk: {
        Args: { _cleanup?: boolean }
        Returns: Json
      }
      _test_phase20_financial_core: {
        Args: { _cleanup?: boolean }
        Returns: Json
      }
      _test_phase21_communication_core: {
        Args: { _verbose?: boolean }
        Returns: Json
      }
      _test_phase24_chat_unified: { Args: never; Returns: Json }
      _test_phase24_finance_core_rebuild: { Args: never; Returns: Json }
      _test_phase24_security_rls_permissions: {
        Args: never
        Returns: {
          detail: string
          ok: boolean
          scenario: string
        }[]
      }
      _test_phase24b2_store_cash_delivery_guardrails: {
        Args: never
        Returns: Json
      }
      _test_phase24d1_permissions_admin: {
        Args: never
        Returns: {
          detail: string
          passed: boolean
          test: string
        }[]
      }
      _test_phase25_machines_workcenters_operations: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          ok: boolean
        }[]
      }
      _test_phase3: { Args: never; Returns: Json }
      _test_phase4: { Args: never; Returns: Json }
      _test_phase5: { Args: never; Returns: Json }
      _test_phase6: { Args: never; Returns: Json }
      _test_phase7: { Args: never; Returns: Json }
      _test_phase8: { Args: never; Returns: Json }
      _test_phase9: { Args: never; Returns: Json }
      _test_purchase_need_to_po_flow: {
        Args: never
        Returns: {
          detail: string
          passed: boolean
          scenario: string
        }[]
      }
      _test_supply_canonical_path: { Args: never; Returns: Json }
      _tpntpo_internal_neg: { Args: { _prod: string }; Returns: number }
      _tpntpo_internal_qty: {
        Args: { _prod: string; _var: string }
        Returns: number
      }
      _wh_main_internal_loc: { Args: { _wh: string }; Returns: string }
      account_archive: { Args: { _id: string }; Returns: undefined }
      account_upsert: {
        Args: {
          _active?: boolean
          _code: string
          _id: string
          _name: string
          _notes?: string
          _parent_id?: string
          _type: string
        }
        Returns: string
      }
      activity_list_for_entity: {
        Args: {
          _entity_id: string
          _entity_type: string
          _include_customer_visible?: boolean
        }
        Returns: Json
      }
      activity_log_event: {
        Args: {
          _entity_id: string
          _entity_type: string
          _event_type: string
          _message: string
          _metadata?: Json
          _visibility?: string
        }
        Returns: string
      }
      allocate_payment_to_schedules: {
        Args: { _so: string }
        Returns: undefined
      }
      allocation_on_inventory_adjustment_positive: {
        Args: { _adj_id: string }
        Returns: Json
      }
      allocation_on_manual_release: {
        Args: {
          _location_id: string
          _product_id: string
          _qty: number
          _source_event_id?: string
          _variant_id: string
        }
        Returns: Json
      }
      allocation_on_po_receipt: { Args: { _picking_id: string }; Returns: Json }
      allocation_on_return_good: {
        Args: { _mode?: string; _package_id: string }
        Returns: Json
      }
      apply_customer_credit: {
        Args: {
          _amount: number
          _credit_id: string
          _customer_payment_id?: string
          _notes?: string
          _sale_order_id?: string
        }
        Returns: Json
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
      bank_reconciliation_confirm_match: {
        Args: {
          _customer_payment_id?: string
          _line_id: string
          _supplier_payment_id?: string
        }
        Returns: undefined
      }
      bank_reconciliation_line_create: {
        Args: { _payload: Json }
        Returns: string
      }
      bank_reconciliation_match_customer_payment: {
        Args: { _line_id: string; _payment_id: string }
        Returns: undefined
      }
      bank_reconciliation_unmatch: {
        Args: { _line_id: string; _reason: string }
        Returns: undefined
      }
      bank_statement_import_create: {
        Args: {
          _column_map: Json
          _file_kind: string
          _file_name: string
          _journal_id: string
          _name: string
        }
        Returns: string
      }
      bank_statement_line_insert: {
        Args: {
          _amount: number
          _balance: number
          _description: string
          _import_id: string
          _occurred_on: string
          _raw: Json
          _reference: string
        }
        Returns: string
      }
      bom_delete_line: { Args: { p_id: string }; Returns: boolean }
      bom_delete_output: { Args: { p_id: string }; Returns: boolean }
      bom_delete_variant_rule: { Args: { p_id: string }; Returns: boolean }
      bom_preview_resolved: {
        Args: {
          _bom_id: string
          _context?: Json
          _product_id: string
          _qty?: number
          _variant_id?: string
        }
        Returns: Json
      }
      bom_upsert_line: {
        Args: {
          p_applies_to_variant_rule: Json
          p_bom_id: string
          p_component_product_id: string
          p_component_selector: Json
          p_component_variant_id: string
          p_consumption_uom_id: string
          p_conversion_factor: number
          p_formula: string
          p_formula_variables: Json
          p_id: string
          p_inheritance_action: string
          p_is_critical: boolean
          p_is_optional: boolean
          p_operation_id: string
          p_parent_bom_line_id: string
          p_qty_formula: string
          p_quantity: number
          p_rounding_method: string
          p_sequence: number
          p_uom_id: string
          p_work_center_id: string
        }
        Returns: string
      }
      bom_upsert_master: {
        Args: {
          p_active: boolean
          p_applies_to_product_id: string
          p_applies_to_variant_id: string
          p_code: string
          p_id: string
          p_inheritance_mode: string
          p_is_master: boolean
          p_parent_bom_id: string
          p_product_id: string
          p_quantity: number
          p_type: string
          p_uom_id: string
          p_variant_id: string
          p_variant_rule: Json
        }
        Returns: string
      }
      bom_upsert_output: {
        Args: {
          p_active: boolean
          p_bom_id: string
          p_bom_line_id: string
          p_condition: string
          p_cost_allocation_percent: number
          p_formula: string
          p_id: string
          p_operation_id: string
          p_output_type: string
          p_product_id: string
          p_qty: number
          p_stockable: boolean
          p_uom_id: string
          p_work_center_id: string
        }
        Returns: string
      }
      bom_upsert_variant_rule: {
        Args: {
          p_active: boolean
          p_attribute_name: string
          p_attribute_value: string
          p_bom_id: string
          p_formula: string
          p_id: string
          p_priority: number
          p_product_id: string
          p_qty: number
          p_rule_type: string
          p_source_component_id: string
          p_target_component_id: string
          p_uom_id: string
          p_variant_id: string
        }
        Returns: string
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
      cancel_customer_payment: {
        Args: { _payment_id: string; _reason?: string }
        Returns: {
          account_id: string | null
          amount: number
          cash_session_id: string | null
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
          reconciled_at: string | null
          reconciled_by: string | null
          reconciliation_line_id: string | null
          reconciliation_status: string
          reference: string | null
          refund_of: string | null
          schedule_id: string | null
          state: string
          store_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customer_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_mo: { Args: { _mo: string }; Returns: undefined }
      cancel_picking: {
        Args: { _cascade?: boolean; _picking: string }
        Returns: undefined
      }
      cancel_purchase_need: { Args: { _id: string }; Returns: Json }
      cancel_purchase_order: { Args: { _order: string }; Returns: undefined }
      cancel_sale_order: {
        Args: { _options?: Json; _order_id: string }
        Returns: Json
      }
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
      cash_movement_reconcile: {
        Args: { _movement_id: string; _payload?: Json }
        Returns: Json
      }
      cash_movement_reverse: {
        Args: { _movement_id: string; _reason: string }
        Returns: Json
      }
      cash_movement_unreconcile: {
        Args: { _movement_id: string; _reason: string }
        Returns: Json
      }
      cash_session_balance: { Args: { _session: string }; Returns: number }
      cash_session_for_current_user: {
        Args: { _store_id?: string }
        Returns: Json
      }
      cash_session_summary: { Args: { _session: string }; Returns: Json }
      chat_channel_created_by: { Args: { _channel: string }; Returns: string }
      chat_channel_is_public: { Args: { _channel: string }; Returns: boolean }
      close_cash_session: {
        Args: { _counted: number; _session: string }
        Returns: undefined
      }
      close_mo:
        | { Args: { _mo: string }; Returns: Json }
        | { Args: { _mo: string; _qty_produced?: number }; Returns: Json }
      confirm_pending_payment: {
        Args: { _payment: string }
        Returns: undefined
      }
      confirm_purchase_order: { Args: { _order: string }; Returns: undefined }
      confirm_sale_order: { Args: { _order: string }; Returns: undefined }
      conversation_add_message: {
        Args: {
          _message: string
          _metadata?: Json
          _thread_id: string
          _visibility?: string
        }
        Returns: string
      }
      conversation_add_participant: {
        Args: { _payload: Json; _thread_id: string }
        Returns: string
      }
      conversation_channel_get_or_create: {
        Args: { _channel_id: string }
        Returns: string
      }
      conversation_close: {
        Args: { _reason?: string; _thread_id: string }
        Returns: Json
      }
      conversation_create: { Args: { _payload: Json }; Returns: string }
      conversation_dm_get_or_create: {
        Args: { _other_user_id: string }
        Returns: string
      }
      conversation_get_messages: {
        Args: { _limit?: number; _thread_id: string }
        Returns: Json
      }
      conversation_list_for_entity: {
        Args: { _entity_id: string; _entity_type: string }
        Returns: Json
      }
      conversation_mark_read: { Args: { _thread_id: string }; Returns: Json }
      conversation_messages: {
        Args: { _thread_id: string; _visibility_filter?: string }
        Returns: Json
      }
      conversation_send_message:
        | {
            Args: { _body: string; _thread_id: string; _visibility?: string }
            Returns: string
          }
        | {
            Args: {
              _attachments?: Json
              _body: string
              _thread_id: string
              _visibility?: string
            }
            Returns: string
          }
      conversation_unified_list: { Args: { _limit?: number }; Returns: Json }
      cost_center_archive: { Args: { _id: string }; Returns: Json }
      cost_center_upsert: { Args: { _payload: Json }; Returns: Json }
      create_batch: { Args: { _pickings: string[] }; Returns: string }
      create_customer_credit: {
        Args: {
          _amount: number
          _idempotency_key?: string
          _origin_payment_id?: string
          _origin_service_case_id?: string
          _partner_id: string
          _reason?: string
        }
        Returns: Json
      }
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
          _variant?: string
        }
        Returns: string
      }
      create_return_from_picking: {
        Args: { _lines: Json; _picking_id: string }
        Returns: string
      }
      create_route_manual: {
        Args: {
          _delivery_only?: boolean
          _driver_id?: string
          _max_assembly_minutes?: number
          _max_deliveries?: number
          _notes?: string
          _route_date: string
          _vehicle_id?: string
          _zone_id: string
        }
        Returns: string
      }
      create_wave: { Args: { _moves: string[] }; Returns: string }
      current_user_default_store_id: { Args: never; Returns: string }
      current_user_store_ids: { Args: never; Returns: string[] }
      customer_delivery_request_schedule: {
        Args: {
          _notes?: string
          _preferred_date: string
          _sale_order_id: string
          _token: string
        }
        Returns: string
      }
      customer_location_id: { Args: never; Returns: string }
      customer_portal_order_status: { Args: { _token: string }; Returns: Json }
      customer_portal_token_create: {
        Args: {
          _customer_id: string
          _expires_at?: string
          _sale_order_id?: string
          _scope?: string
          _service_case_id?: string
        }
        Returns: Json
      }
      customer_portal_validate_token: {
        Args: { _scope?: string; _token: string }
        Returns: Json
      }
      customer_service_case_status: {
        Args: { _service_case_id: string; _token: string }
        Returns: Json
      }
      customer_ticket_add_attachment_metadata: {
        Args: { _payload: Json; _ticket_id: string; _token: string }
        Returns: string
      }
      customer_ticket_add_message: {
        Args: { _message: string; _ticket_id: string; _token: string }
        Returns: string
      }
      customer_ticket_close: {
        Args: { _reason?: string; _ticket_id: string; _token: string }
        Returns: Json
      }
      customer_ticket_create: {
        Args: { _payload: Json; _token: string }
        Returns: string
      }
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
      delivery_schedule_confirm: {
        Args: { _schedule_id: string }
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
      discuss_add_member: {
        Args: { _channel: string; _user: string }
        Returns: undefined
      }
      discuss_bridge_channel_to_conversation: {
        Args: { _channel_id: string }
        Returns: string
      }
      discuss_create_channel: {
        Args: {
          _description?: string
          _is_private?: boolean
          _members?: string[]
          _name: string
        }
        Returns: string
      }
      discuss_mark_read: { Args: { _channel: string }; Returns: undefined }
      discuss_open_dm: { Args: { _other: string }; Returns: string }
      discuss_remove_member: {
        Args: { _channel: string; _user: string }
        Returns: undefined
      }
      discuss_send_message:
        | {
            Args: {
              _body?: string
              _channel_id: string
              _image_url?: string
              _mentions?: string[]
            }
            Returns: string
          }
        | {
            Args: {
              _attachments?: Json
              _body?: string
              _channel_id: string
              _image_url?: string
              _mentions?: string[]
            }
            Returns: string
          }
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
      driver_reopen_session: { Args: { _session: string }; Returns: undefined }
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
      erp_allocation_health_check: {
        Args: { _threshold_hours?: number }
        Returns: Json
      }
      erp_allocation_safe_remediation: {
        Args: { _dry_run?: boolean }
        Returns: Json
      }
      erp_communication_health_check: {
        Args: { _threshold_hours?: number }
        Returns: Json
      }
      erp_customer_portal_health_check: {
        Args: { _threshold_days?: number }
        Returns: Json
      }
      erp_financial_health_check: { Args: never; Returns: Json }
      erp_health_check: { Args: { _threshold_days?: number }; Returns: Json }
      erp_health_check_damaged_packages: { Args: never; Returns: Json }
      erp_health_check_run: {
        Args: { _threshold_days?: number }
        Returns: string
      }
      erp_health_check_shopfloor: {
        Args: { _threshold_days?: number }
        Returns: Json
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
      erp_service_health_check: {
        Args: { _threshold_days?: number }
        Returns: Json
      }
      erp_service_repair_health_check: {
        Args: { _threshold_days?: number }
        Returns: Json
      }
      erp_task_assign: {
        Args: {
          _assigned_group?: string
          _assigned_to: string
          _task_id: string
        }
        Returns: Json
      }
      erp_task_cancel: {
        Args: { _reason: string; _task_id: string }
        Returns: Json
      }
      erp_task_complete: {
        Args: { _notes?: string; _task_id: string }
        Returns: Json
      }
      erp_task_create: { Args: { _payload: Json }; Returns: string }
      erp_task_list_for_user: {
        Args: { _limit?: number; _status?: string }
        Returns: Json
      }
      erp_task_start: { Args: { _task_id: string }; Returns: Json }
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
      generate_routes:
        | { Args: { _horizon_days?: number }; Returns: number }
        | {
            Args: { _horizon_days?: number; _zone_ids?: string[] }
            Returns: number
          }
      get_module_setting: {
        Args: { _default: Json; _key: string; _module: string }
        Returns: Json
      }
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
      helpdesk_ticket_add_message: {
        Args: { _internal?: boolean; _message: string; _ticket_id: string }
        Returns: string
      }
      helpdesk_ticket_assign: {
        Args: { _assigned_to: string; _ticket_id: string }
        Returns: Json
      }
      helpdesk_ticket_close: {
        Args: { _resolution: string; _ticket_id: string }
        Returns: Json
      }
      helpdesk_ticket_convert_to_service_case: {
        Args: { _payload?: Json; _ticket_id: string }
        Returns: string
      }
      helpdesk_ticket_create: { Args: { _payload: Json }; Returns: string }
      is_chat_channel_member: {
        Args: { _channel: string; _user: string }
        Returns: boolean
      }
      is_manufacturing_component: {
        Args: { _product_id: string }
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
      is_product_allocation_compatible: {
        Args: {
          _product_id: string
          _target_line_id: string
          _variant_id: string
        }
        Returns: boolean
      }
      is_sale_line_compatible_for_allocation: {
        Args: { _source_line_id: string; _target_line_id: string }
        Returns: boolean
      }
      is_thread_participant: {
        Args: { _thread: string; _user: string }
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
      log_schedule_event: {
        Args: {
          _meta?: Json
          _msg: string
          _picking: string
          _so: string
          _type: string
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
      machine_archive: {
        Args: { _machine_id: string; _reason: string }
        Returns: Json
      }
      machine_upsert: {
        Args: { _machine_id: string; _payload: Json }
        Returns: string
      }
      manufacturing_operation_archive: {
        Args: { _operation_id: string; _reason: string }
        Returns: Json
      }
      manufacturing_operation_upsert: {
        Args: { _operation_id: string; _payload: Json }
        Returns: string
      }
      merge_purchase_orders: {
        Args: { _sources: string[]; _target: string }
        Returns: undefined
      }
      mfg_allocate_components_from_stock: {
        Args: {
          _location_id: string
          _product_id: string
          _qty: number
          _reason?: string
          _variant_id: string
        }
        Returns: Json
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
        Args: { _line: string; _qty?: number; _so: string }
        Returns: string
      }
      mfg_create_needs_for_mo: { Args: { _mo: string }; Returns: number }
      mfg_create_orders_for_sale: { Args: { _so: string }; Returns: number }
      mfg_eval_formula: {
        Args: { _formula: string; _vars?: Json }
        Returns: number
      }
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
      mfg_materialize_work_orders: { Args: { _mo_id: string }; Returns: number }
      mfg_next_code: { Args: never; Returns: string }
      mfg_pause_operation: {
        Args: { _op: string; _reason: string }
        Returns: undefined
      }
      mfg_plan_components: {
        Args: { _depth?: number; _mo: string }
        Returns: Json
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
      mfg_reserve_components_on_receipt: {
        Args: { _stock_move_id: string }
        Returns: Json
      }
      mfg_resolve_issue: {
        Args: { _issue: string; _resolution: string }
        Returns: undefined
      }
      mfg_start_operation: {
        Args: { _op: string; _override_reason?: string }
        Returns: undefined
      }
      mfg_suggest_component_allocation: {
        Args: { _product_id: string; _qty: number; _variant_id: string }
        Returns: {
          mo_component_id: string
          mo_id: string
          priority_rank: number
          suggested_qty: number
        }[]
      }
      mfg_sync_sol_status: { Args: { _mo: string }; Returns: undefined }
      next_sequence: { Args: { _code: string }; Returns: string }
      next_service_case_number: { Args: never; Returns: string }
      next_ticket_number: { Args: never; Returns: string }
      notification_create: { Args: { _payload: Json }; Returns: string }
      notification_list_for_user: {
        Args: { _category?: string; _limit?: number; _status?: string }
        Returns: Json
      }
      notification_mark_all_read: {
        Args: { _category?: string }
        Returns: Json
      }
      notification_mark_read: {
        Args: { _notification_id: string }
        Returns: Json
      }
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
      permissions_health_check: {
        Args: never
        Returns: {
          code: string
          detail: string
          entity_id: string
          severity: string
        }[]
      }
      picking_return_status: { Args: { _picking_id: string }; Returns: Json }
      picking_scan_reset_quantity_done: {
        Args: { _picking: string }
        Returns: number
      }
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
      product_archive: {
        Args: { _product_id: string; _reason?: string }
        Returns: Json
      }
      product_available_qty: {
        Args: { _product: string; _warehouse: string }
        Returns: number
      }
      product_effective_cost: { Args: { _product: string }; Returns: number }
      product_manufacturing_configuration_check: {
        Args: { _product_id: string }
        Returns: Json
      }
      product_package_template_delete: {
        Args: { _template_id: string }
        Returns: Json
      }
      product_package_template_upsert: {
        Args: { _payload: Json; _product_id: string; _template_id: string }
        Returns: string
      }
      product_stock_summary: { Args: { _product_id: string }; Returns: Json }
      product_template_attribute_delete: {
        Args: { _attribute_id: string }
        Returns: Json
      }
      product_template_attribute_upsert: {
        Args: { _attribute_id: string; _payload: Json; _product_id: string }
        Returns: string
      }
      product_template_attribute_value_delete: {
        Args: { _value_id: string }
        Returns: Json
      }
      product_template_attribute_value_delete_pair: {
        Args: { _template_attribute_id: string; _value_id: string }
        Returns: Json
      }
      product_template_attribute_value_upsert: {
        Args: {
          _payload: Json
          _template_attribute_id: string
          _value_id: string
        }
        Returns: string
      }
      product_upsert: {
        Args: { _payload?: Json; _product_id?: string }
        Returns: string
      }
      product_variant_delete: { Args: { _variant_id: string }; Returns: Json }
      product_variant_upsert: {
        Args: { _payload: Json; _product_id: string; _variant_id: string }
        Returns: string
      }
      purchase_can_manage: { Args: { _uid: string }; Returns: boolean }
      purchase_need_remaining_qty: { Args: { _id: string }; Returns: number }
      purchase_needs_create_po: {
        Args: {
          _expected_date?: string
          _need_ids: string[]
          _supplier_id?: string
        }
        Returns: Json
      }
      purchase_order_change_state: {
        Args: { _new_state: string; _po_id: string; _reason?: string }
        Returns: Json
      }
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
      record_message_post: {
        Args: {
          _body: string
          _entity_id: string
          _entity_type: string
          _visibility?: string
        }
        Returns: string
      }
      recurring_expense_cancel: {
        Args: { _expense_id: string; _reason: string }
        Returns: Json
      }
      recurring_expense_create: { Args: { _payload: Json }; Returns: Json }
      recurring_expense_generate_bill: {
        Args: { _expense_id: string }
        Returns: Json
      }
      recurring_expense_update: {
        Args: { _expense_id: string; _payload: Json }
        Returns: Json
      }
      refresh_order_services: { Args: { _order: string }; Returns: undefined }
      refund_customer_payment: {
        Args: { _payment: string; _reason?: string }
        Returns: string
      }
      register_customer_payment:
        | {
            Args: {
              _amount: number
              _idempotency_key?: string
              _journal?: string
              _method: string
              _notes?: string
              _order: string
              _payment_date?: string
              _reference?: string
              _schedule?: string
            }
            Returns: {
              account_id: string | null
              amount: number
              cash_session_id: string | null
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
              reconciled_at: string | null
              reconciled_by: string | null
              reconciliation_line_id: string | null
              reconciliation_status: string
              reference: string | null
              refund_of: string | null
              schedule_id: string | null
              state: string
              store_id: string | null
            }
            SetofOptions: {
              from: "*"
              to: "customer_payments"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              _amount: number
              _cash_session_id?: string
              _idempotency_key?: string
              _journal?: string
              _method: string
              _notes?: string
              _order: string
              _payment_date?: string
              _reference?: string
              _schedule?: string
            }
            Returns: {
              account_id: string | null
              amount: number
              cash_session_id: string | null
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
              reconciled_at: string | null
              reconciled_by: string | null
              reconciliation_line_id: string | null
              reconciliation_status: string
              reference: string | null
              refund_of: string | null
              schedule_id: string | null
              state: string
              store_id: string | null
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
      resolve_bom_for_variant: {
        Args: {
          _context?: Json
          _product_id: string
          _qty?: number
          _variant_id?: string
        }
        Returns: Json
      }
      resolve_cash_session_for_user: {
        Args: { _explicit_session?: string; _store_ids: string[] }
        Returns: string
      }
      route_capacity_used: {
        Args: { _route: string }
        Returns: {
          assembly_minutes: number
          deliveries: number
        }[]
      }
      run_inventory_allocation: {
        Args: {
          _location_id?: string
          _product_id: string
          _qty?: number
          _reason?: string
          _variant_id?: string
        }
        Returns: Json
      }
      run_reordering_rules: { Args: never; Returns: number }
      sale_line_packages_ready: {
        Args: { _sale_order_line_id: string }
        Returns: Json
      }
      sale_line_qty_missing: { Args: { _line_id: string }; Returns: number }
      sale_order_mark_invoiced: {
        Args: {
          _invoice_date?: string
          _invoice_notes?: string
          _invoice_number?: string
          _order_id: string
        }
        Returns: Json
      }
      sale_order_reconciliation: { Args: { _order_id: string }; Returns: Json }
      sale_order_revert_invoice_status: {
        Args: { _order_id: string; _reason?: string }
        Returns: Json
      }
      sale_order_schedule_delivery: {
        Args: {
          _notes?: string
          _route_id?: string
          _sale_order_id: string
          _scheduled_date: string
          _slot_end?: string
          _slot_start?: string
        }
        Returns: Json
      }
      sale_order_set_delivery_mode: {
        Args: { _delivery_mode: string; _order_id: string }
        Returns: Json
      }
      sale_order_set_delivery_zone: {
        Args: {
          _delivery_region_rule_id?: string
          _delivery_zip_rule_id?: string
          _order_id: string
        }
        Returns: Json
      }
      sale_order_set_services: {
        Args: {
          _include_assembly: boolean
          _include_delivery: boolean
          _order_id: string
        }
        Returns: Json
      }
      sale_payment_schedule_delete: {
        Args: { _reason?: string; _schedule_id: string }
        Returns: Json
      }
      sale_payment_schedule_upsert: {
        Args: { _payload: Json; _sale_order_id: string; _schedule_id: string }
        Returns: string
      }
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
      service_can_manage: { Args: { _uid: string }; Returns: boolean }
      service_can_view: { Args: { _uid: string }; Returns: boolean }
      service_case_add_attachment_metadata: {
        Args: { _case_id: string; _payload: Json }
        Returns: string
      }
      service_case_add_item: {
        Args: { _case_id: string; _payload: Json }
        Returns: string
      }
      service_case_cancel: {
        Args: { _case_id: string; _reason: string }
        Returns: Json
      }
      service_case_charge_add: {
        Args: {
          _amount: number
          _customer_credit_id?: string
          _customer_payment_id?: string
          _kind: string
          _notes?: string
          _partner_id: string
          _service_case_id: string
        }
        Returns: Json
      }
      service_case_close: {
        Args: { _case_id: string; _resolution: string }
        Returns: Json
      }
      service_case_cost_add: {
        Args: {
          _description: string
          _kind: string
          _notes?: string
          _quantity: number
          _service_case_id: string
          _supplier_id?: string
          _unit_cost: number
        }
        Returns: Json
      }
      service_case_create: { Args: { _payload: Json }; Returns: string }
      service_case_create_from_damaged_package: {
        Args: {
          _action?: string
          _description?: string
          _stock_package_id: string
        }
        Returns: string
      }
      service_case_create_manufacturing_order: {
        Args: { _case_item_id: string }
        Returns: string
      }
      service_case_create_purchase_need: {
        Args: { _case_item_id: string }
        Returns: string
      }
      service_case_dispose_package: {
        Args: { _case_item_id: string; _reason: string }
        Returns: Json
      }
      service_case_release_repaired_to_stock: {
        Args: { _case_item_id: string; _target_location_id?: string }
        Returns: Json
      }
      service_case_repair_complete: {
        Args: { _case_item_id: string; _notes?: string; _result: string }
        Returns: Json
      }
      service_case_repair_start: {
        Args: { _case_item_id: string; _notes?: string }
        Returns: Json
      }
      service_case_schedule_assistance: {
        Args: { _case_id: string; _preferred_date: string; _zone_id?: string }
        Returns: string
      }
      service_case_triage: {
        Args: { _case_id: string; _payload: Json }
        Returns: Json
      }
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
      set_module_setting: {
        Args: { _key: string; _module: string; _value: Json }
        Returns: Json
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
      so_apply_delivery_rollup: { Args: { _so: string }; Returns: Json }
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
      suggest_inventory_allocation: {
        Args: { _product_id: string; _qty?: number; _variant_id?: string }
        Returns: Json
      }
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
      supplier_bill_cancel: {
        Args: { _bill_id: string; _reason: string }
        Returns: Json
      }
      supplier_bill_create: { Args: { _payload: Json }; Returns: Json }
      supplier_bill_create_from_po: {
        Args: {
          _bill_date?: string
          _idempotency_key?: string
          _lines?: Json
          _po_id: string
          _reference?: string
        }
        Returns: Json
      }
      supplier_bill_set_attachments: {
        Args: { _attachments: Json; _bill_id: string }
        Returns: Json
      }
      supplier_bill_update: {
        Args: { _bill_id: string; _payload: Json }
        Returns: Json
      }
      supplier_location_id: { Args: never; Returns: string }
      supplier_payment_cancel: {
        Args: { _payment_id: string; _reason: string }
        Returns: Json
      }
      supplier_payment_register: {
        Args: {
          _account_id?: string
          _amount: number
          _bill_id: string
          _cost_center_id?: string
          _idempotency_key?: string
          _journal_id?: string
          _method_id?: string
          _payment_date?: string
          _reference?: string
        }
        Returns: Json
      }
      supplier_payment_set_attachments: {
        Args: { _attachments: Json; _payment_id: string }
        Returns: Json
      }
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
      transfer_sale_reservation: {
        Args: {
          _from_sale_order_line_id: string
          _qty: number
          _reason?: string
          _to_sale_order_line_id: string
        }
        Returns: Json
      }
      try_reserve_picking: { Args: { _picking: string }; Returns: undefined }
      update_product_operational_config: {
        Args: {
          _allocation_policy: string
          _component_allocation_policy: string
          _package_tracking_enabled: boolean
          _product_id: string
          _supply_route: string
        }
        Returns: Json
      }
      user_role_assign: {
        Args: { _group_code: string; _user_id: string }
        Returns: string
      }
      user_role_remove: {
        Args: { _group_code: string; _user_id: string }
        Returns: undefined
      }
      user_store_assignment_remove: {
        Args: { _assignment_id: string; _reason: string }
        Returns: undefined
      }
      user_store_assignment_set_default: {
        Args: { _assignment_id: string }
        Returns: undefined
      }
      user_store_assignment_upsert: {
        Args: {
          _active?: boolean
          _is_default?: boolean
          _role?: string
          _store_id: string
          _user_id: string
        }
        Returns: string
      }
      validate_batch: { Args: { _batch: string }; Returns: Json }
      validate_customer_pickup: {
        Args: { _payment?: Json; _pickup_id: string }
        Returns: Json
      }
      validate_picking: { Args: { _picking: string }; Returns: undefined }
      validate_wave: { Args: { _wave: string }; Returns: undefined }
      work_center_archive: {
        Args: { _reason: string; _work_center_id: string }
        Returns: Json
      }
      work_center_upsert: {
        Args: { _payload: Json; _work_center_id: string }
        Returns: string
      }
      work_order_finish: {
        Args: {
          _notes?: string
          _qty_done: number
          _qty_scrap?: number
          _work_order_id: string
        }
        Returns: Json
      }
      work_order_pause: {
        Args: { _reason?: string; _work_order_id: string }
        Returns: Json
      }
      work_order_quality_check: {
        Args: { _notes?: string; _result: string; _work_order_id: string }
        Returns: Json
      }
      work_order_report_issue: {
        Args: {
          _description: string
          _issue_kind: string
          _work_order_id: string
        }
        Returns: Json
      }
      work_order_resume: { Args: { _work_order_id: string }; Returns: Json }
      work_order_start: {
        Args: {
          _employee_id?: string
          _machine_id?: string
          _override_reason?: string
          _work_order_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      allocation_policy:
        | "strict_order"
        | "stock_pool_first"
        | "oldest_order_first"
        | "delivery_date_first"
        | "paid_priority"
        | "manual_allocation"
        | "custom_priority"
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
        | "helpdesk"
      bom_type: "normal" | "phantom" | "subcontract"
      component_allocation_policy:
        | "manufacturing_first"
        | "sales_first"
        | "oldest_need_first"
        | "manual"
      location_type:
        | "internal"
        | "supplier"
        | "customer"
        | "transit"
        | "inventory_loss"
        | "production"
        | "view"
      machine_status: "available" | "busy" | "maintenance" | "inactive"
      mfg_skill_level: "trainee" | "normal" | "skilled" | "specialist"
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
        | "machine_unavailable"
        | "employee_unavailable"
        | "quality_failed"
      mo_op_state:
        | "pending"
        | "ready"
        | "in_progress"
        | "paused"
        | "done"
        | "blocked"
      mo_origin:
        | "sale"
        | "manual"
        | "replenishment"
        | "rework"
        | "other"
        | "service_case"
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
      product_supply_route:
        | "buy"
        | "manufacture"
        | "buy_or_manufacture"
        | "manual"
      product_tracking: "none" | "lot" | "serial"
      product_type: "storable" | "consumable" | "service"
      purchase_need_origin:
        | "sale"
        | "manufacturing"
        | "min_stock"
        | "manual"
        | "forecast"
        | "service_case"
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
      service_case_attachment_type:
        | "customer_photo"
        | "delivery_photo"
        | "warehouse_photo"
        | "before_repair"
        | "after_repair"
        | "supplier_evidence"
        | "other"
      service_case_item_action:
        | "repair"
        | "replace"
        | "send_part"
        | "pickup_return"
        | "inspect"
        | "refund"
        | "supplier_claim"
        | "manufacture_part"
        | "buy_part"
      service_case_item_issue_type:
        | "damaged"
        | "missing"
        | "defective"
        | "wrong_item"
        | "wear_and_tear"
        | "other"
      service_case_item_status:
        | "open"
        | "waiting_part"
        | "part_ready"
        | "scheduled"
        | "done"
        | "cancelled"
      service_case_priority: "low" | "normal" | "high" | "urgent"
      service_case_responsibility:
        | "supplier"
        | "internal_manufacturing"
        | "delivery_team"
        | "customer"
        | "unknown"
      service_case_source:
        | "customer"
        | "delivery_team"
        | "warehouse"
        | "manufacturing"
        | "quality"
        | "internal"
        | "other"
      service_case_status:
        | "new"
        | "triage"
        | "waiting_photos"
        | "waiting_supplier"
        | "waiting_parts"
        | "waiting_manufacturing"
        | "waiting_schedule"
        | "scheduled"
        | "in_route"
        | "done"
        | "cancelled"
        | "rejected"
      service_case_type:
        | "delivery_issue"
        | "customer_claim"
        | "warranty"
        | "supplier_defect"
        | "internal_rework"
        | "damaged_return"
        | "missing_part"
        | "other"
      service_case_warranty_status:
        | "in_warranty"
        | "out_of_warranty"
        | "goodwill"
        | "unknown"
      service_task_status: "open" | "in_progress" | "done" | "cancelled"
      service_task_type:
        | "triage"
        | "request_photos"
        | "buy_part"
        | "manufacture_part"
        | "repair"
        | "schedule_assistance"
        | "pickup"
        | "supplier_claim"
        | "close_case"
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
      work_center_type:
        | "manual"
        | "machine"
        | "cutting"
        | "sewing"
        | "upholstery"
        | "assembly"
        | "quality"
        | "packing"
        | "other"
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
      allocation_policy: [
        "strict_order",
        "stock_pool_first",
        "oldest_order_first",
        "delivery_date_first",
        "paid_priority",
        "manual_allocation",
        "custom_priority",
      ],
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
        "helpdesk",
      ],
      bom_type: ["normal", "phantom", "subcontract"],
      component_allocation_policy: [
        "manufacturing_first",
        "sales_first",
        "oldest_need_first",
        "manual",
      ],
      location_type: [
        "internal",
        "supplier",
        "customer",
        "transit",
        "inventory_loss",
        "production",
        "view",
      ],
      machine_status: ["available", "busy", "maintenance", "inactive"],
      mfg_skill_level: ["trainee", "normal", "skilled", "specialist"],
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
        "machine_unavailable",
        "employee_unavailable",
        "quality_failed",
      ],
      mo_op_state: [
        "pending",
        "ready",
        "in_progress",
        "paused",
        "done",
        "blocked",
      ],
      mo_origin: [
        "sale",
        "manual",
        "replenishment",
        "rework",
        "other",
        "service_case",
      ],
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
      product_supply_route: [
        "buy",
        "manufacture",
        "buy_or_manufacture",
        "manual",
      ],
      product_tracking: ["none", "lot", "serial"],
      product_type: ["storable", "consumable", "service"],
      purchase_need_origin: [
        "sale",
        "manufacturing",
        "min_stock",
        "manual",
        "forecast",
        "service_case",
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
      service_case_attachment_type: [
        "customer_photo",
        "delivery_photo",
        "warehouse_photo",
        "before_repair",
        "after_repair",
        "supplier_evidence",
        "other",
      ],
      service_case_item_action: [
        "repair",
        "replace",
        "send_part",
        "pickup_return",
        "inspect",
        "refund",
        "supplier_claim",
        "manufacture_part",
        "buy_part",
      ],
      service_case_item_issue_type: [
        "damaged",
        "missing",
        "defective",
        "wrong_item",
        "wear_and_tear",
        "other",
      ],
      service_case_item_status: [
        "open",
        "waiting_part",
        "part_ready",
        "scheduled",
        "done",
        "cancelled",
      ],
      service_case_priority: ["low", "normal", "high", "urgent"],
      service_case_responsibility: [
        "supplier",
        "internal_manufacturing",
        "delivery_team",
        "customer",
        "unknown",
      ],
      service_case_source: [
        "customer",
        "delivery_team",
        "warehouse",
        "manufacturing",
        "quality",
        "internal",
        "other",
      ],
      service_case_status: [
        "new",
        "triage",
        "waiting_photos",
        "waiting_supplier",
        "waiting_parts",
        "waiting_manufacturing",
        "waiting_schedule",
        "scheduled",
        "in_route",
        "done",
        "cancelled",
        "rejected",
      ],
      service_case_type: [
        "delivery_issue",
        "customer_claim",
        "warranty",
        "supplier_defect",
        "internal_rework",
        "damaged_return",
        "missing_part",
        "other",
      ],
      service_case_warranty_status: [
        "in_warranty",
        "out_of_warranty",
        "goodwill",
        "unknown",
      ],
      service_task_status: ["open", "in_progress", "done", "cancelled"],
      service_task_type: [
        "triage",
        "request_photos",
        "buy_part",
        "manufacture_part",
        "repair",
        "schedule_assistance",
        "pickup",
        "supplier_claim",
        "close_case",
      ],
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
      work_center_type: [
        "manual",
        "machine",
        "cutting",
        "sewing",
        "upholstery",
        "assembly",
        "quality",
        "packing",
        "other",
      ],
    },
  },
} as const
