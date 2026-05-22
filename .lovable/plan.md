## Plano

### 1) Fatura PO → Contas a Pagar (BILL/20260522/002440535)

A fatura existe (`state='posted'`, `purchase_order_id` definido) e a tabela `supplier_bills` tem RLS via `has_permission('finance','bills','view')`. Como o grupo "Financeiro - Gerente/Operador" já tem essa permissão, o utilizador atual provavelmente está num grupo sem ela.

**Correção:**
- Verificar a quais grupos o utilizador pertence (via UI Configurações) — se faltar, atribuir grupo Financeiro.
- Garantir que `system_admin` cai no `has_permission` (já cai).
- Adicionar fallback: conceder também `finance.bills.view/edit` ao grupo "Compras - Gerente" (quem cria a fatura), para que o autor consiga acompanhar.
- Adicionar atalho no PO: bloco "Faturas geradas" listando bills com link para `/finance/payables/:id`.

### 2) Página de Perfil (todos os utilizadores)

Nova rota `/profile` (e link no avatar da topbar):
- Editar `full_name`, `phone`.
- Upload de avatar para bucket `avatars` (cria bucket público se não existir). Atualiza `profiles.avatar_url`.
- Alterar senha (`supabase.auth.updateUser({ password })`).
- Exibir avatar na topbar, no chat (Discuss + GlobalChatDock), e ao lado do utilizador nas mensagens.

### 3) Chat (Discuss + GlobalChatDock)

**Comuns:**
- Emoji picker (`emoji-picker-react` já leve, ou `@emoji-mart/react`). Botão 😀 abre popover, insere no textarea.
- Anexos: imagens (já existe) + documentos (PDF/DOCX/XLSX) com upload no bucket `chat-attachments`. Renderizar como card com ícone + nome + tamanho + link.
- Confirmação de leitura: badge "Visto por …" já existe em /discuss. Adicionar no GlobalChatDock (✓✓ azul quando o outro participante leu).
- Avatares (foto de perfil) ao lado das mensagens.

**Canais privados + membros (no /discuss):**
- Dialog "Novo canal" passa a ter switch "Privado" e seletor multi-utilizador.
- Painel de canal privado: botão "Membros" → dialog para adicionar/remover (RPC `discuss_add_member`, `discuss_remove_member`).

**GlobalChatDock:**
- Botão anexar + botão emoji; envia via RPC `conversation_send_message` (suportar `_attachments`).
- Mostrar avatar do remetente.

### 4) Chat dentro do app Entregas

- `/delivery/discuss` já existe. Aplicar melhorias:
  - Lista compacta com avatar + badge não-lido.
  - Suporte a foto/anexos/emoji (mesmo componente).
  - Notificação sonora opcional em nova mensagem (toggle silenciar).

### Base de dados (migrations)

- Bucket `avatars` público (insert + policies de upload pelo próprio user).
- Bucket `chat-attachments` (já existe) — garantir policies para PDFs.
- `chat_messages.attachments jsonb` (já existe) — passar a guardar `[{url,name,size,mime}]`.
- RPCs novas:
  - `discuss_add_member(_channel uuid, _user uuid)` (apenas owner/admin do canal).
  - `discuss_remove_member(_channel uuid, _user uuid)`.
  - `discuss_create_channel(_name text, _is_private bool, _description text, _members uuid[])`.
- `conversation_send_message`: aceitar `_attachments jsonb`.
- Conceder `finance.bills.view` ao grupo Compras (para visualizar bill gerada).

### Ficheiros a criar/editar (principais)

- `src/pages/Profile.tsx` (novo)
- `src/core/layout/UserMenu.tsx` (link "Meu perfil")
- `src/core/chat/EmojiButton.tsx`, `src/core/chat/AttachmentButton.tsx`, `src/core/chat/AttachmentBubble.tsx` (componentes partilhados)
- `src/modules/discuss/Discuss.tsx` — switch privado, gestão de membros, emojis, docs
- `src/core/conversations/GlobalChatDock.tsx` — anexos, emojis, avatares, leitura
- `src/modules/purchase/pages/PurchaseOrderDetail*.tsx` — secção "Faturas geradas"
- Migrations SQL (1 ficheiro) com buckets, RPCs e permissão.

### Dependências
- `emoji-picker-react` (~50 kB gz) — para o picker.

Continuo já com a implementação.
