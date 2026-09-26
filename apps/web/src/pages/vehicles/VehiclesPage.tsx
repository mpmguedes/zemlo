import { Link } from 'react-router-dom';
import { formatNumber } from '@zemlo/shared';
import { useReminders, useVehicles } from '../../api/hooks';
import { errorMessage, errorRequestId } from '../../api/errors';
import { Card, Chip, EmptyState, InlineError, LoadingBlock, PageHeader } from '../../ui/primitives';
import { VehicleGlyph } from '../../ui/vehicleGlyphs';
import { vehicleStates } from '../../lib/vehicleState';
import { VehicleCard, vehicleTitle } from '../../components/VehicleCard';

/**
 * Lista de veículos — decisão UX/UI 43, «Cartões de veículos».
 *
 * ## O que mudou e porquê
 *
 * Antes, a mesma lista aparecia duas vezes: uma lista de linhas em telemóvel e uma tabela
 * de sete colunas em ambiente de trabalho, escolhidas por CSS. A auditoria `A1_4` registou
 * o custo: a página obrigava a manter dois desenhos da mesma informação, e o ecrã mostrava
 * um deles a quem não o queria ver. A decisão 43 substitui os dois por **um** cartão, que é
 * o mesmo elemento em telemóvel e em ambiente de trabalho — muda a largura e a densidade,
 * não a identidade.
 *
 * A tabela trazia três colunas que o cartão não tem — ano, tipo e última leitura — e é
 * preciso dizer o que lhes aconteceu, porque não desapareceram por esquecimento:
 *
 *  - **tipo** passou para a linha de metadados, ao lado da energia (o pedido da decisão:
 *    «tipo de veículo / energia, por exemplo elétrico»);
 *  - **ano** saiu. Numa lista de veículos da mesma conta o ano não decide nada — não se
 *    escolhe um carro pelo ano quando já se sabe qual é qual, e é um número que o cartão
 *    pagaria em ruído. Continua na ficha do veículo, que é onde se comparam especificações;
 *  - **última leitura** passou para o rodapé, ao lado da quilometragem: é o par que diz se
 *    o número da quilometragem é de confiança. Sozinha, uma quilometragem sem data é uma
 *    afirmação sem prazo.
 *
 * O botão «Abrir» da tabela também desapareceu, e não faz falta: o cartão inteiro é a
 * ligação, o que dá um alvo de toque muito maior do que um botão de 32 px.
 *
 * ## O que não mudou
 *
 * O veículo arquivado continua distinguido e não escondido — quem vendeu um carro quer
 * continuar a consultar o histórico dele (§24) sem o ver misturado com os que ainda tem.
 * A secção «Arquivados» mantém-se, com o mesmo tratamento discreto de antes.
 */

/*
 * O `vehicleTitle` e o `VehicleCard` viviam aqui, como componentes **locais** desta página.
 * Saíram para `components/VehicleCard.tsx` quando a decisão `56` passou a precisar do mesmo
 * cartão no seletor de veículo do registo: mantê-lo aqui obrigaria a uma segunda cópia, e duas
 * cópias de um cartão divergem à primeira alteração de estilo.
 *
 * O que fica nesta página é a **lista**: o pedido de veículos, o mapa de estados por veículo e
 * a grelha que os dispõe. O cartão em si é um componente partilhado.
 */

export function VehiclesPage() {
  const { data, isLoading, isError, error, refetch } = useVehicles(false);
  const archived = useVehicles(true);

  /*
   * Um só pedido para os estados de todos os veículos. `vehicleStates` explica porque é
   * que a lista completa serve (e porque é que um pedido por veículo seria pior).
   */
  const reminders = useReminders({});
  const states = vehicleStates(reminders.data?.items ?? []);

  const archivedVehicles = (archived.data?.items ?? []).filter((vehicle) => vehicle.archived);

  return (
    <div className="z-page">
      <PageHeader
        title="Veículos"
        subtitle="Todos os veículos da tua conta, por atividade recente."
        actions={
          <Link to="/vehicles/new" className="z-btn z-btn--primary">
            Adicionar veículo
          </Link>
        }
      />

      {isLoading ? <LoadingBlock label="A carregar os veículos…" /> : null}

      {isError ? (
        <InlineError
          message={errorMessage(error)}
          requestId={errorRequestId(error)}
          onRetry={() => void refetch()}
        />
      ) : null}

      {data && data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<VehicleGlyph type="car" />}
            title="Ainda não tens veículos"
            body="Basta a matrícula. O ano, a versão, o VIN e a cor completam-se depois, na ficha do veículo, se quiseres."
            action={
              <Link to="/vehicles/new" className="z-btn z-btn--primary">
                Adicionar o primeiro veículo
              </Link>
            }
          />
        </Card>
      ) : null}

      {data && data.items.length > 0 ? (
        <div className="z-vehicle-grid">
          {data.items.map((vehicle) => (
            <VehicleCard key={vehicle.id} vehicle={vehicle} state={states.get(vehicle.id)} />
          ))}
        </div>
      ) : null}

      {archivedVehicles.length > 0 ? (
        <Card soft>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Arquivados</div>
              <div className="z-card__subtitle">
                Veículos que já não tens, mas cujo histórico se mantém. Arquivar não apaga nada.
              </div>
            </div>
            <Chip>{formatNumber(archivedVehicles.length, 0)}</Chip>
          </div>
          <div className="z-list">
            {archivedVehicles.map((vehicle) => (
              <Link key={vehicle.id} to={`/vehicles/${vehicle.id}`} className="z-list__item" style={{ paddingInline: 0 }}>
                <span className="z-list__icon" aria-hidden="true">
                  <VehicleGlyph type={vehicle.vehicleType} />
                </span>
                <span className="z-list__body">
                  <span className="z-list__title">{vehicleTitle(vehicle)}</span>
                  <span className="z-list__meta">{vehicle.plateDisplay} · arquivado</span>
                </span>
              </Link>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
