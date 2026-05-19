import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface UseRpcMutationOptions<TArgs, TData> {
  rpc: string;
  successMessage?: string;
  errorMessage?: string;
  invalidateKeys?: QueryKey[];
  onSuccess?: (data: TData, args: TArgs) => void | Promise<void>;
  onError?: (error: Error, args: TArgs) => void;
}

/**
 * Standardised wrapper around supabase.rpc + react-query useMutation.
 * - Shows sonner toast on success/error.
 * - Invalidates the provided query keys.
 * - Prevents double-submit via isPending.
 */
export function useRpcMutation<TArgs extends Record<string, unknown> = Record<string, unknown>, TData = unknown>({
  rpc,
  successMessage,
  errorMessage,
  invalidateKeys,
  onSuccess,
  onError,
}: UseRpcMutationOptions<TArgs, TData>) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (args: TArgs) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)(rpc, args);
      if (error) throw new Error(error.message);
      return data as TData;
    },
    onSuccess: async (data, args) => {
      if (successMessage) toast.success(successMessage);
      if (invalidateKeys) {
        await Promise.all(invalidateKeys.map((k) => qc.invalidateQueries({ queryKey: k })));
      }
      await onSuccess?.(data, args);
    },
    onError: (err: Error, args) => {
      toast.error(errorMessage ?? err.message ?? "Erro ao executar ação");
      onError?.(err, args);
    },
  });
  return mutation;
}
