# Indicador de capacidade no Cronograma de Rotas

## Objetivo

Tornar visível, em cada card de rota do calendário (`/routes/schedule`), a ocupação atual vs capacidade — sem precisar abrir o detalhe da rota.

## Mudanças

### 1. Query — incluir campos de capacidade

Em `RoutesSchedule.tsx`, expandir o `select` das rotas para trazer:
- `cap_deliveries`, `current_deliveries`
- `cap_volume_m3`, `current_volume_m3`
- `cap_assembly_minutes`, `current_assembly_minutes`
- `vehicles(usable_volume_m3, volume_m3, max_stops, assembly_minutes_capacity)` (para fallback quando o cap manual está em branco)

### 2. Componente `RouteCapacityMini`

Novo componente compacto reutilizável para o card de rota:

- 3 mini-barras horizontais finas (h-1) com label curto:
  - **Paragens** — `current_deliveries / cap_deliveries`
  - **m³** — `current_volume_m3 / cap_volume_m3`
  - **Mont.** — `current_assembly_minutes / cap_assembly_minutes`
- Cada barra com cor semântica:
  - verde (`bg-emerald-500`) < 75%
  - âmbar (`bg-amber-500`) 75–94%
  - vermelho (`bg-rose-500`) ≥ 95%
- Se um cap for `null`, mostra label "—" cinza (sem barra)
- Usa `resolveRouteCapacityStatus` existente para o badge global ("Livre/Atenção/Saturado")

### 3. Integração no card da rota

No card de rota dentro de cada célula do calendário (vista semanal e mensal):
- Acrescentar `<RouteCapacityMini route={r} />` logo abaixo da linha com zona + viatura
- Badge de estado de capacidade no canto superior direito do card

### 4. Tooltip detalhado

Hover no card mostra tooltip com valores absolutos:
- "Paragens: 4 / 10"
- "Volume: 6.2 / 12.0 m³"
- "Montagem: 90 / 240 min"
- "Fonte: viatura X" quando o cap vier do fallback do veículo

### 5. Sem alterações no backend

Os campos `current_*` já são mantidos pelos triggers existentes (`recalc_route_capacity`). Só leitura.

## Fora de scope

- Editar `cap_*` inline no card (continua via detalhe da rota)
- Drag/drop de entregas para realocar capacidade
- Otimização automática

## Verificação

- Card mostra barras corretas para rota com viatura vinculada
- Card mostra "—" cinza para rota sem viatura e sem cap manual
- Cores mudam conforme thresholds 75 / 95
- Vista mensal e semanal ambos renderizam mini-barras
