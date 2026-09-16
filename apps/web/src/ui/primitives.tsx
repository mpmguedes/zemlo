import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Primitivas de interface.
 *
 * Um único ficheiro, por deliberação: são poucos elementos e todos partilham as mesmas
 * regras de alvo de toque, estados de carregamento e acessibilidade. Separados em dez
 * ficheiros, a regra «nenhum botão abaixo de 44 px» deixaria de ter um sítio óbvio onde
 * ser verificada.
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'highlight';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  className?: string;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  loading = false,
  icon,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'z-btn',
    `z-btn--${variant}`,
    size === 'sm' ? 'z-btn--sm' : '',
    block ? 'z-btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      // `aria-busy` informa o leitor de ecrã de que o botão está ocupado sem que o rótulo
      // mude — mudar o texto de "Guardar" para "A guardar…" faz o leitor perder a
      // referência ao botão que carregou.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
    >
      {loading ? <span className="z-btn__spinner" aria-hidden="true" /> : icon ? <span className="z-btn__icon" aria-hidden="true">{icon}</span> : null}
      {children}
    </button>
  );
}

/**
 * Botão com aparência de botão mas semântica de ligação.
 *
 * Existe porque um `<a>` estilizado como botão perde o comportamento nativo (abrir em
 * novo separador, pré-visualização no canto do ecrã) e um `<button>` que navega engana os
 * leitores de ecrã.
 */
export function ButtonLink({
  to,
  variant = 'secondary',
  size = 'md',
  block = false,
  icon,
  children,
  className,
}: {
  to: string;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  block?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const classes = [
    'z-btn',
    `z-btn--${variant}`,
    size === 'sm' ? 'z-btn--sm' : '',
    block ? 'z-btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Link to={to} className={classes}>
      {icon ? <span className="z-btn__icon" aria-hidden="true">{icon}</span> : null}
      {children}
    </Link>
  );
}

export function Card({
  children,
  className,
  flush = false,
  soft = false,
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
  soft?: boolean;
}) {
  const classes = ['z-card', flush ? 'z-card--flush' : '', soft ? 'z-card--soft' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return <section className={classes}>{children}</section>;
}

/**
 * Secção com título.
 *
 * `children` é opcional de propósito: há secções que são apenas um título com uma contagem no
 * `hint` e cujo conteúdo é o que vem a seguir no fluxo do ecrã (por exemplo, «3 registos»
 * seguido da tabela). Obrigar a embrulhar a lista para satisfazer o tipo produziria uma
 * `<section>` só para calar o compilador.
 */
export function Section({
  title,
  hint,
  action,
  children,
  className,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`z-section${className ? ` ${className}` : ''}`}>
      <header className="z-section__header">
        <h2 className="z-section__title">{title}</h2>
        {hint ? <span className="z-section__hint">{hint}</span> : null}
        {action}
      </header>
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Rota de regresso. Apresentada apenas em telemóvel, onde não há histórico visível. */
  back?: { to: string; label: string };
}) {
  return (
    <header className="z-page__header">
      <div className="z-page__header-row">
        <div>
          {back ? (
            <Link to={back.to} className="z-xs z-muted" style={{ display: 'inline-block', marginBottom: 4 }}>
              ← {back.label}
            </Link>
          ) : null}
          <h1>{title}</h1>
          {subtitle ? <p className="z-page__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="z-row z-row--wrap">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Metric({
  label,
  value,
  hint,
  small = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  small?: boolean;
}) {
  return (
    <div className="z-metric">
      <span className="z-metric__label">{label}</span>
      <span className={`z-metric__value${small ? ' z-metric__value--sm' : ''} z-numeric`}>{value}</span>
      {hint ? <span className="z-metric__hint">{hint}</span> : null}
    </div>
  );
}

export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'warn' | 'danger' | 'ok';
}) {
  return <span className={`z-chip${tone === 'neutral' ? '' : ` z-chip--${tone}`}`}>{children}</span>;
}

type BannerTone = 'info' | 'ok' | 'warn' | 'danger';

const BANNER_ICON: Record<BannerTone, string> = {
  info: 'ℹ️',
  ok: '✅',
  warn: '⏳',
  danger: '⚠️',
};

export function Banner({
  tone = 'info',
  title,
  children,
  actions,
  icon,
}: {
  tone?: BannerTone;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
  icon?: string;
}) {
  return (
    <div className={`z-banner z-banner--${tone}`}>
      {/* `role="status"` em vez de `alert`: um aviso informativo não deve interromper
          uma leitura em curso no leitor de ecrã. */}
      <span className="z-banner__icon" aria-hidden="true">
        {icon ?? BANNER_ICON[tone]}
      </span>
      <div className="z-banner__body">
        {title ? <div className="z-banner__title">{title}</div> : null}
        {children}
        {actions ? <div className="z-banner__actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: string;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="z-empty">
      <span className="z-empty__icon" aria-hidden="true">
        {icon}
      </span>
      <p className="z-empty__title">{title}</p>
      <p className="z-empty__body">{body}</p>
      {action}
    </div>
  );
}

export function Skeleton({ lines = 3, card = false }: { lines?: number; card?: boolean }) {
  if (card) {
    return (
      <div className="z-stack" aria-hidden="true">
        <div className="z-skeleton z-skeleton--card" />
        <div className="z-skeleton z-skeleton--card" />
      </div>
    );
  }
  return (
    <div className="z-stack z-stack--tight" aria-hidden="true">
      <div className="z-skeleton z-skeleton--title" />
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="z-skeleton z-skeleton--line" />
      ))}
    </div>
  );
}

/**
 * Estado de carregamento anunciado.
 *
 * O `role="status"` com texto visível para leitores de ecrã evita o pior cenário de uma
 * interface assíncrona: um ecrã que não diz nada a quem não vê os esqueletos cinzentos.
 */
export function LoadingBlock({ label = 'A carregar…' }: { label?: string }) {
  return (
    <div className="z-page-loading" role="status">
      <span className="z-sr-only">{label}</span>
      <Skeleton card />
    </div>
  );
}

export function InlineError({
  message,
  requestId,
  onRetry,
  retryLabel = 'Tentar novamente',
}: {
  message: string;
  requestId?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="z-inline-error" role="alert">
      <span>{message}</span>
      {requestId ? (
        <span className="z-request-id">Referência para apoio: {requestId}</span>
      ) : null}
      {onRetry ? (
        <div>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function DetailList({ children }: { children: ReactNode }) {
  return <dl className="z-detail-list">{children}</dl>;
}

export function DetailRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="z-detail-list__row">
      <dt className="z-detail-list__label">{label}</dt>
      <dd className="z-detail-list__value z-numeric">{value}</dd>
    </div>
  );
}

/**
 * Divulgação progressiva.
 *
 * É o mecanismo que faz a diferença entre um formulário de 3 campos e um de 14 (§43): o
 * que não é essencial fica atrás de um botão, e o estado do botão é anunciado
 * (`aria-expanded`) para que a abertura seja percetível com leitor de ecrã.
 */
export function Disclosure({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="z-disclosure" open={defaultOpen || undefined}>
      <summary
        className="z-disclosure__toggle"
        style={{ listStyle: 'none', display: 'flex' }}
      >
        {label}
        <span className="z-disclosure__chevron" aria-hidden="true">
          ›
        </span>
      </summary>
      <div className="z-stack" style={{ paddingTop: 'var(--z-space-3)' }}>
        {children}
      </div>
    </details>
  );
}
