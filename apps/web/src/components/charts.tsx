import { useMemo } from 'react';
import { formatCents, formatNumber, safeRatio, type CategoryTotal, type MonthlyTotal } from '@zemlo/shared';
import { moneyCompact } from '../lib/format';

/**
 * Gráficos em SVG e CSS, sem biblioteca.
 *
 * A aplicação não pode acrescentar dependências e, para o que o produto precisa — série
 * mensal, repartição por categoria, evolução de consumo — uma biblioteca de gráficos
 * traria mais código morto do que funcionalidade. Estes componentes desenham diretamente o
 * que a §23 pede, com três decisões transversais:
 *
 *  - **o texto é HTML, não `<text>` de SVG.** Um `<text>` de SVG não herda o tamanho de
 *    letra do contexto, não reflui e é mal dimensionado pelos motores de ampliação. Os
 *    rótulos e os valores vivem fora do gráfico;
 *  - **`aria-label` descritivo + tabela equivalente.** Uma imagem de barras sem
 *    alternativa é informação perdida para quem usa leitor de ecrã; por isso todos os
 *    gráficos expõem a série em texto;
 *  - **a cor nunca é o único canal.** A parcela de energia distingue-se pela cor *e* pela
 *    legenda; um estado distingue-se pela cor *e* pelo texto.
 */

/* -------------------------------------------------------------------------- */
/* Barras mensais                                                              */
/* -------------------------------------------------------------------------- */

export interface BarsProps {
  data: MonthlyTotal[];
  /** Rótulo do total representado, para o leitor de ecrã. */
  ariaLabel: string;
}

/**
 * Série mensal em barras verticais.
 *
 * A parcela de energia é desenhada em âmbar sobre a base de cada barra. É o único uso de
 * âmbar num gráfico, e é intencional: a pergunta que o utilizador faz ao ver a evolução do
 * custo é "isto é combustível ou é manutenção?", e a resposta tem de saltar à vista. Como o
 * âmbar marca o que se destaca e não decora séries, o resto fica em petróleo.
 *
 * A altura de cada barra é proporcional ao **máximo da série** e não a um máximo teórico:
 * com um teto fixo, um mês de 80 € desapareceria ao lado de um mês de 800 €, e o gráfico
 * deixaria de mostrar a variação que interessa.
 */
export function MonthlyBars({ data, ariaLabel }: BarsProps) {
  const maximum = useMemo(() => Math.max(1, ...data.map((month) => month.amountCents)), [data]);
  const hasEnergy = data.some((month) => month.energyCents > 0);

  return (
    <figure style={{ margin: 0 }}>
      <div className="z-bars" role="img" aria-label={ariaLabel}>
        {data.map((month) => {
          const totalHeight = (month.amountCents / maximum) * 100;
          const energyShare = month.amountCents > 0 ? safeRatio(month.energyCents, month.amountCents) ?? 0 : 0;
          const energyHeight = totalHeight * energyShare;
          return (
            <div className="z-bars__column" key={month.month}>
              <div
                className="z-bars__stack"
                title={`${month.label}: ${formatCents(month.amountCents)}`}
              >
                <div className="z-bars__fill" style={{ height: `${totalHeight}%` }} />
                {energyHeight > 0 ? (
                  <div className="z-bars__fill z-bars__fill--energy" style={{ height: `${energyHeight}%` }} />
                ) : null}
              </div>
              <span className="z-bars__label">{month.label}</span>
            </div>
          );
        })}
      </div>
      {hasEnergy ? (
        <figcaption className="z-bars__legend" style={{ marginTop: 'var(--z-space-2)' }}>
          <span className="z-bars__legend-item">
            <span className="z-bars__swatch" style={{ background: 'var(--z-chart-accent)' }} aria-hidden="true" />
            Energia (combustível e carregamento)
          </span>
          <span className="z-bars__legend-item">
            <span className="z-bars__swatch" style={{ background: 'var(--z-chart-1)' }} aria-hidden="true" />
            Todos os custos
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* Repartição por categoria                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Repartição por categoria, em barras horizontais.
 *
 * Barras e não um gráfico circular: com catorze categorias possíveis (as do registo), um
 * círculo obriga a comparar ângulos e a sobreviver a legendas em volta; barras ordenadas
 * fazem a leitura por ordem decrescente, que é a pergunta real ("onde é que gasto mais?").
 *
 * As categorias sem valor são omitidas — mostrar catorze linhas com zeros é ruído — mas a
 * decisão de omitir é explícita e o rodapé informa quantas ficaram de fora.
 */
export function CategoryBreakdown({ categories }: { categories: CategoryTotal[] }) {
  const visible = categories.filter((category) => category.amountCents !== 0 || category.count > 0);
  const hidden = categories.length - visible.length;
  const maximum = Math.max(1, ...visible.map((category) => category.amountCents));

  if (visible.length === 0) return null;

  return (
    <div>
      <div role="img" aria-label={`Repartição por categoria: ${visible.map((c) => `${c.label} ${formatCents(c.amountCents)}`).join('; ')}`}>
        {visible.map((category) => (
          <div className="z-bar-row" key={category.category}>
            <span className="z-row" style={{ gap: 'var(--z-space-2)' }}>
              <span aria-hidden="true">{category.icon}</span>
              <span>{category.label}</span>
              <span className="z-xs z-muted">
                {formatNumber(category.count, 0)} {category.count === 1 ? 'registo' : 'registos'}
              </span>
            </span>
            <span className="z-numeric z-strong">
              {formatCents(category.amountCents)}
              {category.share !== null ? <span className="z-xs z-muted"> · {formatNumber(category.share * 100, 1)} %</span> : null}
            </span>
            <span className="z-bar-row__track">
              <span className="z-bar-row__fill" style={{ width: `${(category.amountCents / maximum) * 100}%` }} />
            </span>
          </div>
        ))}
      </div>
      {hidden > 0 ? (
        <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-2)' }}>
          {hidden === 1 ? 'Uma categoria sem custos' : `${hidden} categorias sem custos`} neste período não
          {hidden === 1 ? ' aparece' : ' aparecem'} na lista.
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Evolução de consumo                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Linha de evolução de um consumo.
 *
 * Desenhada num `<svg>` com `viewBox` e sem largura fixa, para escalar com o cartão. Os
 * pontos sem valor (`null`) são **saltados**, não ligados: num gráfico de consumo, ligar
 * dois pontos separados por um mês sem dados desenharia uma tendência que não existe — e a
 * §49 é explícita em que o Zemlo prefere não mostrar a mostrar um número inventado.
 */
export function ConsumptionLine({
  series,
  unit,
  ariaLabel,
}: {
  series: Array<{ month: string; label: string; value: number | null }>;
  unit: string;
  ariaLabel: string;
}) {
  const points = series
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry): entry is typeof entry & { value: number } => entry.value !== null);

  if (points.length < 2) {
    return (
      <p className="z-small z-muted">
        Ainda não há leituras suficientes para mostrar uma evolução. Bastam dois registos com
        depósito cheio (ou dois carregamentos) e quilometragem.
      </p>
    );
  }

  const values = points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  // Uma série constante (raro, mas acontece) produziria uma divisão por zero; o intervalo
  // mínimo de 1 mantém a linha ao centro em vez de a colar ao topo.
  const span = maximum - minimum || 1;
  const width = 100;
  const height = 100;
  const step = width / (series.length - 1);

  const coordinates = points.map((point) => {
    const x = point.index * step;
    // Eixo Y invertido: em SVG, o topo é zero, e um consumo maior tem de ficar mais alto.
    const y = height - ((point.value - minimum) / span) * (height - 12) - 6;
    return { x, y, ...point };
  });

  const path = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const area = `${path} L${width} ${height} L0 ${height} Z`;

  return (
    <figure style={{ margin: 0 }}>
      <svg className="z-sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
        <path className="z-sparkline__area" d={area} />
        <path className="z-sparkline__line" d={path} vectorEffect="non-scaling-stroke" />
        {coordinates.map((point) => (
          <circle key={point.month} className="z-sparkline__dot" cx={point.x} cy={point.y} r={1.6} />
        ))}
      </svg>
      <figcaption className="z-row z-row--between z-xs z-muted" style={{ marginTop: 'var(--z-space-1)' }}>
        <span>
          mínimo {formatNumber(minimum, 2)} {unit}
        </span>
        <span>
          máximo {formatNumber(maximum, 2)} {unit}
        </span>
      </figcaption>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* Anel de composição                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Anel com a composição do total (energia, manutenção, custos fixos, outros).
 *
 * Implementado com uma única forma de anel e quatro arcos definidos por `stroke-dasharray`
 * sobre o perímetro da circunferência. Não há biblioteca, não há canvas: o anel é um
 * `<circle>` com traço — o que também o torna impresso com nitidez e acessível por
 * `aria-label`.
 */
export function CompositionDonut({
  slices,
  total,
  ariaLabel,
}: {
  slices: Array<{ label: string; value: number; color: string }>;
  total: number;
  ariaLabel: string;
}) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="z-donut">
      <div className="z-donut__figure">
        <svg viewBox="0 0 132 132" role="img" aria-label={ariaLabel} width="132" height="132">
          <circle cx="66" cy="66" r={radius} fill="none" stroke="var(--z-bg-sunken)" strokeWidth="16" />
          {slices.map((slice) => {
            const fraction = total > 0 ? slice.value / total : 0;
            const length = fraction * circumference;
            const dash = `${length} ${circumference - length}`;
            const element = (
              <circle
                key={slice.label}
                cx="66"
                cy="66"
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth="16"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                // Rodar -90° para que a primeira fatia comece no topo, que é onde o olho
                // começa a ler um gráfico circular.
                transform="rotate(-90 66 66)"
              />
            );
            offset += length;
            return element;
          })}
        </svg>
        <div className="z-donut__center">
          <span className="z-donut__total z-numeric">{moneyCompact(total)}</span>
          <span className="z-donut__caption">no período</span>
        </div>
      </div>
      <ul className="z-stack z-stack--tight" style={{ flex: 1, minWidth: 160 }}>
        {slices.map((slice) => (
          <li className="z-row z-row--between" key={slice.label}>
            <span className="z-row" style={{ gap: 'var(--z-space-2)' }}>
              <span className="z-bars__swatch" style={{ background: slice.color }} aria-hidden="true" />
              <span className="z-small">{slice.label}</span>
            </span>
            <span className="z-small z-strong z-numeric">{formatCents(slice.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
