/**
 * Iconografia de veículo — SVG local, sem dependência externa.
 *
 * ## Porque é que este ficheiro existe
 *
 * Até aqui o veículo era identificado por um **emoji** (`VehicleSummary.emoji`, que vem de
 * `VEHICLE_TYPES[].icon` em `packages/shared/src/registry.ts`). O emoji tem três problemas
 * que a auditoria UX/UI registou e que este módulo resolve:
 *
 *  1. **Não é a mesma coisa em todo o lado.** O desenho do glifo é escolhido pelo sistema
 *     operativo (Segoe UI Emoji no Windows, Noto no Android, Apple Color Emoji no iOS), pelo
 *     que o mesmo veículo aparece diferente em cada telemóvel — e num deles pode aparecer a
 *     preto e branco.
 *  2. **Não herda a cor.** Um emoji colorido ignora `currentColor`, logo não participa na
 *     hierarquia tipográfica nem nos estados de interação.
 *  3. **Não é da marca.** O Zemlo tem uma família de traço própria; o emoji é de outra.
 *
 * ## Regras que este módulo segue
 *
 *  - **Traço, não preenchimento.** `fill="none"` + `stroke="currentColor"`, como o resto da
 *    iconografia da proposta (`A1_2` UX-01, `A1_3` §4.3). A cor vem sempre de fora, por
 *    `currentColor` — nenhum caminho tem cor própria.
 *  - **Uma grelha, um traço.** Todos os glifos vivem em `0 0 24 24` com `stroke-width: 1.75`
 *    e extremidades redondas. É o que faz uma família de dez desenhos parecer uma família.
 *  - **Sem texto alternativo próprio.** O `aria-hidden` é sempre `true`: o glifo é decorativo.
 *    Quem identifica o veículo é o nome (marca + modelo), que está sempre escrito ao lado.
 *    Um ícone que se anuncia sozinho faria o leitor de ecrã dizer «automóvel» duas vezes.
 *
 * ## Porque é que os dez tipos têm todos um desenho
 *
 * `VEHICLE_TYPES` tem dez códigos e o contrato garante que qualquer um deles pode chegar
 * aqui. Deixar cair tipos num só glifo genérico faria duas motos parecerem um carro — e a
 * pessoa que tem uma moto é exatamente quem nota. O tipo `other` é o único que reutiliza o
 * desenho do automóvel, porque «outro» não tem forma própria: dar-lhe uma forma inventada
 * seria pior do que a ausência de forma.
 */

/** Glifos por tipo de veículo. Chave = `VehicleType` de `@zemlo/shared`. */
const GLYPH_PATHS = {
  car: [
    'M5 16.5h14',
    'M6.5 16.5v2',
    'M17.5 16.5v2',
    'M5 16.5l1.4-6.2A2 2 0 0 1 8.35 8.8h7.3a2 2 0 0 1 1.95 1.5L19 16.5',
    'M7 13h10',
    'M4 14.5h1',
    'M19 14.5h1',
  ],
  suv: [
    'M4.5 16.5h15',
    'M6.5 16.5v2',
    'M17.5 16.5v2',
    'M4.5 16.5V11a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v5.5',
    'M4.5 12.6h15',
    'M6.5 9V7.6',
    'M17.5 9V7.6',
  ],
  van: [
    'M4.5 16.5h15',
    'M6.5 16.5v2',
    'M17.5 16.5v2',
    'M4.5 16.5V9a2 2 0 0 1 2-2h9l4 4v5.5',
    'M15.5 7v4h4',
    'M4.5 12.8h15',
  ],
  truck: [
    'M3 16.5h18',
    'M5.5 16.5v2',
    'M17.5 16.5v2',
    'M3.5 16.5v-5.5h5l2-3h3.5v8.5',
    'M14 16.5V8h6.5v8.5',
    'M14 11.5h6.5',
  ],
  camper: [
    'M2.5 16.5h19',
    'M5.5 16.5v2',
    'M17.5 16.5v2',
    'M3 16.5V8.5A1.5 1.5 0 0 1 4.5 7h10a1.5 1.5 0 0 1 1.5 1.5v8',
    'M16 16.5v-6h4.5v6',
    'M6.5 10.6h4.2v3H6.5z',
  ],
  motorcycle: [
    'M6 17.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    'M18 17.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    'M6 15h3.6l3.4-4.4h2.6l2.4 4.4',
    'M9.6 15h6',
    'M13 10.6h3.6',
    'M16.6 10.6 18 8.2h1.6',
  ],
  scooter: [
    'M5 17.5a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
    'M18.6 17.5a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
    'M5 15.3h2.4l2.2-4.2h4.2l2.8 4.2h2',
    'M9.6 11.1h4.4',
    'M16.4 11.1V8h2.2',
  ],
  bicycle: [
    'M6 17.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    'M18 17.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    'M6 15l4.6-5.4h3L18 15',
    'M10.6 9.6 12.6 15',
    'M13.6 9.6h2.6l1.4 2.4',
  ],
  quad: [
    'M5 16.4a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    'M19 16.4a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    'M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    'M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    'M6.2 14.4h11.6',
    'M8.2 14.4V11.6h7.6v2.8',
    'M10.4 11.6V9.2h2.6',
  ],
  other: [
    'M5 16.5h14',
    'M6.5 16.5v2',
    'M17.5 16.5v2',
    'M5 16.5l1.4-6.2A2 2 0 0 1 8.35 8.8h7.3a2 2 0 0 1 1.95 1.5L19 16.5',
    'M7 13h10',
    'M4 14.5h1',
    'M19 14.5h1',
  ],
} as const satisfies Record<string, readonly string[]>;

/**
 * Os tipos que têm glifo próprio.
 *
 * Exportado para o teste poder exigir que **todos** os códigos de `VEHICLE_TYPES` estejam
 * aqui. A exaustividade não pode ser imposta pelo tipo enquanto `CodeOf` resolver para
 * `string` (`PC-42`): `Record<VehicleType, …>` é um índice de assinatura e aceita um
 * objecto com zero chaves. O teste é o que a impõe de facto.
 */
export const GLYPH_TYPES: readonly string[] = Object.keys(GLYPH_PATHS);

/**
 * Glifo do tipo de veículo.
 *
 * Aceita `string` e não só `VehicleType` porque o valor vem de uma resposta HTTP: um
 * servidor mais recente pode enviar um código que esta versão da web ainda não conhece, e
 * nesse caso o certo é desenhar o glifo genérico em vez de rebentar ou de não desenhar nada.
 */
export function VehicleGlyph({ type, className }: { type: string; className?: string }) {
  const table: Record<string, readonly string[] | undefined> = GLYPH_PATHS;
  const paths = table[type] ?? GLYPH_PATHS.other;
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
