import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { useHomeAssistantSpec, useVehicles } from '../../api/hooks';
import { errorMessage, errorRequestId } from '../../api/errors';
import { Card, Chip, DetailList, DetailRow, InlineError, LoadingBlock, PageHeader, Section } from '../../ui/primitives';
import { Button } from '../../ui/primitives';
import { useCopyToClipboard } from '../../hooks';
import { useToast } from '../../ui/Toaster';

/**
 * Especificação do Home Assistant (§27, §28).
 *
 * Este ecrã é deliberadamente o mais "técnico" da aplicação, e é por isso que tem de ser o
 * mais claro. Quem o abre está a configurar uma automação em casa e precisa de três coisas,
 * por esta ordem:
 *
 *  1. **o que o Zemlo expõe** — as entidades, com a unidade e a classe de dispositivo que o
 *     Home Assistant usa para as apresentar corretamente nos painéis;
 *  2. **o que falta para cada uma estar disponível** — em linguagem de produto, não em
 *     linguagem de erro. Uma entidade indisponível não é uma avaria: é uma funcionalidade à
 *     espera de um dado que o utilizador controla;
 *  3. **o que fazer** — as instruções da API, mostradas como passos numerados.
 *
 * A API devolve tudo isto em `GET /integrations/home-assistant/spec`, incluindo as
 * instruções já escritas no tom da marca. A interface não as reescreve: se as reescrevesse,
 * haveria duas versões das mesmas instruções — e a do servidor é a que acompanha o
 * comportamento real da integração.
 */
export function HomeAssistantPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const vehicles = useVehicles();
  const vehicleId = searchParams.get('vehicleId') ?? '';
  const spec = useHomeAssistantSpec(vehicleId || undefined);
  const [copied, copy] = useCopyToClipboard();
  const toast = useToast();

  const available = (spec.data?.entities ?? []).filter((entity) => entity.available);
  const unavailable = (spec.data?.entities ?? []).filter((entity) => !entity.available);

  return (
    <div className="z-page">
      <PageHeader
        title="Home Assistant"
        subtitle="Que entidades o Zemlo expõe e o que precisas para as teres disponíveis."
        back={{ to: '/integrations', label: 'Integrações' }}
      />

      {vehicles.data && vehicles.data.items.length > 1 ? (
        <Card soft>
          <div className="z-filters" role="group" aria-label="Veículo">
            <Chip tone={vehicleId === '' ? 'accent' : 'neutral'}>
              <button
                type="button"
                onClick={() => setSearchParams({}, { replace: true })}
                style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}
              >
                Veículo mais recente
              </button>
            </Chip>
            {vehicles.data.items.map((vehicle) => (
              <Chip key={vehicle.id} tone={vehicleId === vehicle.id ? 'accent' : 'neutral'}>
                <button
                  type="button"
                  onClick={() => setSearchParams({ vehicleId: vehicle.id }, { replace: true })}
                  style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}
                >
                  {vehicle.emoji} {vehicle.plateDisplay}
                </button>
              </Chip>
            ))}
          </div>
          <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-2)' }}>
            A disponibilidade de cada entidade é avaliada por veículo: o mesmo Zemlo pode expor
            o consumo do carro a gasóleo e o consumo elétrico do carro a bateria, na mesma casa.
          </p>
        </Card>
      ) : null}

      {spec.isLoading ? <LoadingBlock label="A carregar a especificação…" /> : null}

      {spec.isError ? (
        <InlineError
          message={errorMessage(spec.error)}
          requestId={errorRequestId(spec.error)}
          onRetry={() => void spec.refetch()}
        />
      ) : null}

      {spec.data ? (
        <>
          <Card>
            <div className="z-card__header">
              <div>
                <div className="z-card__title">Instalação</div>
                <div className="z-card__subtitle">
                  Não precisas de configurar MQTT, OAuth nem webhooks à mão.
                </div>
              </div>
            </div>
            <ol className="z-steps-list">
              {spec.data.instructions.map((instruction) => (
                <li key={instruction}>
                  <span>{instruction}</span>
                </li>
              ))}
            </ol>
          </Card>

          <Card soft>
            <div className="z-card__header">
              <div>
                <div className="z-card__title">Detalhes técnicos</div>
                <div className="z-card__subtitle">O que a integração usa por baixo</div>
              </div>
            </div>
            <DetailList>
              <DetailRow label="Versão da descoberta" value={String(spec.data.discoveryVersion)} />
              <DetailRow label="Prefixo de descoberta" value={spec.data.discoveryPrefix} />
              <DetailRow label="Tópico de estado" value={spec.data.stateTopic} />
            </DetailList>
            <div className="z-row" style={{ gap: 'var(--z-space-2)', marginTop: 'var(--z-space-3)' }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void copy(spec.data?.stateTopic ?? '').then((ok) =>
                    toast.show(ok ? 'Tópico copiado.' : 'Não foi possível copiar — seleciona o texto à mão.', {
                      variant: ok ? 'ok' : 'danger',
                    }),
                  );
                }}
              >
                {copied ? '✓ Copiado' : 'Copiar tópico'}
              </Button>
            </div>
          </Card>

          <Section
            title="Entidades disponíveis"
            hint={`${available.length} de ${spec.data.entities.length}`}
          >
            {available.length === 0 ? (
              <Card>
                <p className="z-small z-muted">
                  Ainda nenhuma entidade tem dados. Regista quilometragem, um abastecimento ou um
                  carregamento e as entidades aparecem automaticamente — o Zemlo não expõe
                  sensores sem dados.
                </p>
              </Card>
            ) : (
              <Card flush>
                <div className="z-list">
                  {available.map((entity) => (
                    <div className="z-list__item" key={entity.entityId}>
                      <span className="z-list__icon" aria-hidden="true">
                        {entity.component === 'sensor' ? '📈' : entity.component === 'binary_sensor' ? '🔘' : '🚗'}
                      </span>
                      <span className="z-list__body">
                        <span className="z-list__title">
                          {entity.name}
                          {entity.unitOfMeasurement ? <span className="z-muted"> · {entity.unitOfMeasurement}</span> : null}
                        </span>
                        <span className="z-list__meta z-entity-row__id">{entity.entityId}</span>
                        {entity.deviceClass || entity.stateClass ? (
                          <span className="z-list__meta">
                            {[entity.deviceClass, entity.stateClass].filter(Boolean).join(' · ')}
                          </span>
                        ) : null}
                      </span>
                      <span className="z-list__trailing">
                        <Chip tone="ok">disponível</Chip>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </Section>

          {unavailable.length > 0 ? (
            <Section
              title="Entidades que ainda faltam"
              hint="cada uma diz exatamente o que precisa"
            >
              <Card flush>
                <div className="z-list">
                  {unavailable.map((entity) => (
                    <div className="z-list__item" key={entity.entityId}>
                      <span className="z-list__icon" aria-hidden="true">⏳</span>
                      <span className="z-list__body">
                        <span className="z-list__title">{entity.name}</span>
                        <span className="z-list__meta">{entity.requires}</span>
                        <span className="z-list__meta z-entity-row__id">{entity.entityId}</span>
                      </span>
                      <span className="z-list__trailing">
                        <Chip>faltam dados</Chip>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
              <p className="z-xs z-muted">
                Estas entidades não são um erro nem uma avaria: são o que o Zemlo exporia se
                tivesse os dados. Cada linha diz o que é preciso registar — e é isso que a
                distingue de uma lista de funcionalidades por cumprir.
              </p>
            </Section>
          ) : null}
        </>
      ) : null}

      <p className="z-xs z-muted">
        <Link to="/integrations">← Voltar às integrações</Link>
      </p>
    </div>
  );
}
