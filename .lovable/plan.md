# Expor capacidade da viatura no formulário

## Problema

O formulário em `/inventory/vehicles/:id` (`VehicleForm.tsx`) só expõe: nome, matrícula, código de barras, motorista, caixa, notas, ativo.

Os campos de **capacidade** existem todos na tabela `vehicles` mas estão invisíveis na UI. Sem eles, ao vincular a viatura a uma rota o `cap_volume_m3` fica `null` e o indicador no Cronograma de Rotas mostra "—".

## Mudanças

### 1. Adicionar campos ao `VehicleForm`

Organizados em secções visuais dentro do `SimpleForm`:

**Identificação** (já existe)
- Nome, Matrícula, Código de barras, Motorista, Caixa associado, Notas, Ativo

**Capacidade de carga** (novo)
- `usable_volume_m3` — "Volume útil (m³)" — número, decimal 2 casas — **principal campo para o cronograma**
- `volume_m3` — "Volume total (m³)" — número, decimal 2 casas — fallback
- `max_weight_kg` — "Carga máxima (kg)" — número inteiro
- `weight_kg` — "Tara (kg)" — número inteiro (peso vazio)

**Dimensões úteis do compartimento** (novo, opcional)
- `usable_length_cm` — "Comprimento útil (cm)"
- `usable_width_cm` — "Largura útil (cm)"
- `usable_height_cm` — "Altura útil (cm)"
- `supports_flat_transport` — "Suporta transporte em plano" — boolean

**Capacidade operacional** (novo)
- `max_stops` — "Nº máximo de paragens" — inteiro (usado em `cap_deliveries` da rota)
- `assembly_minutes_capacity` — "Minutos de montagem por turno" — inteiro
- `max_assembly_minutes` — "Limite duro de montagem (min)" — inteiro
- `requires_load_verification` — "Exige verificação de carga" — boolean

### 2. Adicionar colunas à `VehiclesList`

Mostrar na lista: Nome · Matrícula · Volume útil (m³) · Paragens · Motorista · Ativo.

Hoje provavelmente não mostra capacidade, o que dificulta perceber quais viaturas estão "configuradas".

### 3. Helper text / dicas

No campo "Volume útil (m³)" adicionar `helperText`: *"Usado pelo Cronograma de Rotas para calcular a ocupação. Recomendado: medir o compartimento de carga (C×L×A em metros)."*

### 4. Verificação

- Cadastrar viatura nova com `usable_volume_m3 = 12`
- Atribuir à rota no Cronograma de Rotas (Trocar viatura)
- Confirmar que `delivery_routes.cap_volume_m3` fica 12 (trigger automático)
- Confirmar que o card de capacidade mostra a barra de m³ corretamente

## Fora de scope

- Calculadora automática (C×L×A → m³) — pode vir depois como melhoria
- Migrations — todas as colunas já existem
- Mudanças na lógica do backend / triggers
