Diagnóstico confirmado:
- O Jeferson existe como `Jeferson Junior` / `entregas@upmoveis.pt`.
- Ele tem o grupo `delivery_driver`.
- Ele tem caixa atribuído: `Caixa Entrega`, com `driver_id` correto.
- Ele tem sessão de caixa aberta: `CS/00001`, estado `open`, ligada à rota `56a8f3a4-1995-431f-a9bf-e60923000375`.
- O problema provável é de permissões: as políticas atuais de `cash_registers`, `cash_sessions` e `cash_movements` só permitem ver caixa para financeiro/vendas/inventário, mas não para `delivery_driver`. Por isso o app de entregas não consegue ler o caixa dele mesmo.

Plano de correção:
1. Ajustar as regras de acesso do backend para entregadores
   - Permitir que `delivery_driver` veja apenas o próprio caixa onde `cash_registers.driver_id = auth.uid()`.
   - Permitir que veja apenas as próprias sessões desse caixa.
   - Permitir que veja apenas movimentos das próprias sessões.
   - Permitir que execute abertura/prestação de contas via as funções já existentes, sem dar acesso ao módulo financeiro.

2. Manter segurança do entregador limitada
   - Entregadores não terão acesso ao ERP completo.
   - O login de entregador deve entrar/redirecionar para `/delivery`.
   - Rotas fora de `/delivery` e `/discuss` devem ficar bloqueadas para utilizadores que tenham somente `delivery_driver`.

3. Corrigir o app de entregas para carregamento confiável
   - `DeliveryCashbox` deve mostrar estado de carregamento antes de dizer “Não tens caixa associado”.
   - Se a query falhar por permissão, mostrar erro claro em vez de parecer que não há caixa.
   - Confirmar que ele encontra `Caixa Entrega` e a sessão aberta `CS/00001`.

4. Permitir Conversas para entregadores
   - Adicionar rota/entrada acessível para conversas no ambiente permitido do entregador.
   - Manter o restante do ERP inacessível para quem só tem role de entregador.

Arquivos e áreas a alterar depois da aprovação:
- Migração SQL para políticas de `cash_registers`, `cash_sessions` e `cash_movements`.
- `src/pages/Login.tsx` para redirecionar entregador para `/delivery` após login.
- `src/App.tsx` / proteção de rotas para bloquear ERP completo para entregadores puros e permitir `/delivery` + `/discuss`.
- `src/modules/delivery/pages/DeliveryCashbox.tsx` para loading/erro mais correto.
- Possivelmente `src/modules/delivery/DeliveryShell.tsx` para incluir aba/botão de Conversas.