import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { formatKm, todayIn } from '@zemlo/shared';
import { fetchExport, fetchExportBundle } from '../api/queries';
import { errorMessage, errorRequestId } from '../api/errors';
import { saveBlob } from '../api/client';
import { useMetrics, useProfile, useVehicles } from '../api/hooks';
import { Button, ButtonLink, Card, Chip, DetailList, DetailRow, InlineError, LoadingBlock, PageHeader, Section } from '../ui/primitives';
import { useToast } from '../ui/Toaster';
import { dateLong, dateRange } from '../lib/format';
import { formatNumber } from '@zemlo/shared';

/**
 * Exportação (§54).
 *
 * O direito de levar os dados consigo não é uma funcionalidade acessória: é o que torna
 * seguro investir tempo a registar um histórico. Por isso este ecrã existe, explica a
 * **diferença entre os formatos** e diz o que cada um serve.
 *
 * ## Três formatos, dois propósitos
 *
 *  - **JSON** — cópia fiel e completa, com `meta.formatVersion`, pensada para quem quer
 *    processar os dados. Dinheiro em cêntimos, datas civis em `YYYY-MM-DD`: os mesmos tipos
 *    do contrato, sem arredondamentos pelo caminho.
 *  - **CSV** — uma secção por tipo de registo, com separador `;`, vírgula decimal e BOM
 *    UTF-8. O BOM não é um detalhe: sem ele, o Excel em português abre o ficheiro a mostrar
 *    `Ã§Ã£o` em vez de `ção`, e o utilizador conclui que a exportação está avariada. A API
 *    também protege contra injeção de fórmulas — um campo que comece por `=` não é executado
 *    ao abrir a folha.
 *  - **Bundle nativo (ZIP)** — o ficheiro que o Zemlo **reabre**, com os documentos lá
 *    dentro e a verificação de integridade incluída. É este que se usa para uma cópia de
 *    segurança a sério, e é o único que a importação aceita.
 *
 * A distinção entre os dois primeiros e o terceiro não é de grau, é de natureza: o JSON e o
 * CSV são para **ler** (abrir, filtrar, guardar noutro sítio); o bundle é para **voltar**
 * (repor tudo, noutra conta ou depois de um erro). Por isso vivem em cartões separados e com
 * uma frase que diz para que serve cada um — oferecer três botões lado a lado sem essa frase
 * obrigaria o utilizador a descobrir a diferença por tentativa.
 *
 * O download é registado em auditoria do lado do servidor: é uma operação sobre dados
 * pessoais e o utilizador tem de a poder identificar mais tarde.
 */
export function ExportPage() {
  const profile = useProfile();
  const vehicles = useVehicles();
  const metrics = useMetrics();
  const toast = useToast();

  const [vehicleId, setVehicleId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const download = useMutation({
    mutationFn: (format: 'json' | 'csv') =>
      fetchExport({
        format,
        ...(vehicleId ? { vehicleId } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }),
    onSuccess: ({ blob, fileName }, format) => {
      // O nome do ficheiro vem do `Content-Disposition` da API (datado). Só construímos um
      // nome local se o servidor não o tiver enviado — reescrevê-lo sempre produziria um
      // nome diferente do que ficou registado em auditoria.
      const fallback = `zemlo-export-${todayIn(profile.data?.timeZone ?? 'Europe/Lisbon')}.${format}`;
      saveBlob(blob, fileName ?? fallback);
      toast.show(`Exportação ${format.toUpperCase()} transferida.`, { variant: 'ok' });
    },
  });

  /** O bundle nativo. Mutação própria: o ciclo de vida e a mensagem não são os do legado. */
  const downloadBundle = useMutation({
    mutationFn: () => fetchExportBundle(vehicleId ? { vehicleId } : {}),
    onSuccess: ({ blob, fileName }) => {
      const fallback = `zemlo-bundle-${todayIn(profile.data?.timeZone ?? 'Europe/Lisbon')}.zip`;
      saveBlob(blob, fileName ?? fallback);
      toast.show('Cópia de segurança transferida.', { variant: 'ok' });
    },
  });

  const inFlight: 'json' | 'csv' | null = download.isPending ? (download.variables ?? null) : null;

  return (
    <div className="z-page">
      <PageHeader
        title="Exportar dados"
        subtitle="Leva tudo o que está no Zemlo — sem pedir autorização a ninguém."
      />

      <Card>
        <div className="z-stack">
          <div className="z-fields">
            <label className="z-field">
              <span className="z-field__label">Âmbito</span>
              <select className="z-select" value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
                <option value="">Toda a conta</option>
                {(vehicles.data?.items ?? []).map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.emoji} {vehicle.plateDisplay}
                  </option>
                ))}
              </select>
            </label>

            <div className="z-grid z-grid--2">
              <label className="z-field">
                <span className="z-field__label">A partir de</span>
                <input type="date" className="z-input" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
              </label>
              <label className="z-field">
                <span className="z-field__label">Até</span>
                <input type="date" className="z-input" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
              </label>
            </div>

            <p className="z-xs z-muted">
              Sem datas, a exportação inclui todo o histórico.
              {from || to ? ` Com filtro: ${dateRange(from || '1900-01-01', to || todayIn(profile.data?.timeZone ?? 'Europe/Lisbon'))}.` : ''}
            </p>
          </div>

          <div className="z-grid z-grid--2">
            <Card soft>
              <div className="z-card__header">
                <div>
                  <div className="z-card__title">JSON — cópia fiel</div>
                  <div className="z-card__subtitle">Para reimportar ou processar</div>
                </div>
              </div>
              <ul className="z-stack z-stack--tight z-small">
                <li>Estrutura idêntica à da API: cêntimos inteiros e datas civis.</li>
                <li>Inclui um campo <span className="z-mono">meta.formatVersion</span> para reimportação futura.</li>
                <li>Nunca inclui password, segredo de 2FA nem credenciais de integrações.</li>
              </ul>
              <div style={{ marginTop: 'var(--z-space-3)' }}>
                <Button
                  variant="primary"
                  block
                  loading={inFlight === 'json'}
                  onClick={() => download.mutate('json')}
                >
                  Transferir JSON
                </Button>
              </div>
            </Card>

            <Card soft>
              <div className="z-card__header">
                <div>
                  <div className="z-card__title">CSV — para folha de cálculo</div>
                  <div className="z-card__subtitle">Abre corretamente no Excel em português</div>
                </div>
              </div>
              <ul className="z-stack z-stack--tight z-small">
                <li>Uma secção por tipo de registo, no mesmo ficheiro.</li>
                <li>Separador <span className="z-mono">;</span>, vírgula decimal e BOM UTF-8 — sem BOM, o Excel corrompe os acentos.</li>
                <li>Proteção contra injeção de fórmulas em campos de texto livre.</li>
              </ul>
              <div style={{ marginTop: 'var(--z-space-3)' }}>
                <Button
                  variant="secondary"
                  block
                  loading={inFlight === 'csv'}
                  onClick={() => download.mutate('csv')}
                >
                  Transferir CSV
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </Card>

      {/*
       * O bundle nativo ocupa a largura toda e tem o seu próprio cartão, em vez de ser um
       * terceiro botão na grelha de cima. A separação é a mensagem: os dois primeiros
       * ficheiros são para **ler**, este é para **voltar**. Um cartão ao lado dos outros
       * sugeriria que é mais uma variante do mesmo, e é outra coisa.
       */}
      <Card>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">Cópia de segurança — ZIP do Zemlo</div>
            <div className="z-card__subtitle">O único ficheiro que o Zemlo consegue reabrir</div>
          </div>
          <Chip tone="ok">Verificado por integridade</Chip>
        </div>

        <p className="z-small z-muted">
          Leva tudo — registos, relações e os ficheiros dos documentos — num único ZIP. É
          este ficheiro que serve para repor os teus dados mais tarde, aqui ou noutra conta.
        </p>

        <ul className="z-stack z-stack--tight z-small">
          <li>
            Os documentos vão <strong>lá dentro</strong>, com a verificação de integridade de
            cada um. O JSON e o CSV não os levam.
          </li>
          <li>
            Traz as <strong>relações</strong> entre registos: a despesa continua ligada ao
            abastecimento que a originou, o documento continua ligado ao veículo.
          </li>
          <li>
            Os identificadores internos ficam de fora. Um bundle não revela a estrutura da
            tua conta, e por isso pode ser importado noutra.
          </li>
          <li>
            Nunca inclui password, segredo de 2FA nem credenciais de integrações.
          </li>
        </ul>

        <div
          className="z-row"
          style={{ marginTop: 'var(--z-space-3)', gap: 'var(--z-space-2)', alignItems: 'center' }}
        >
          <Button
            variant="primary"
            loading={downloadBundle.isPending}
            onClick={() => downloadBundle.mutate()}
          >
            Transferir cópia de segurança (ZIP)
          </Button>
          <span className="z-xs z-muted">
            Para voltar a pôr estes dados no Zemlo, abre <strong>Importar de um ficheiro</strong> e
            escolhe este ZIP.
          </span>
        </div>

        {downloadBundle.isError ? (
          <div style={{ marginTop: 'var(--z-space-3)' }}>
            <InlineError
              message={errorMessage(downloadBundle.error)}
              requestId={errorRequestId(downloadBundle.error)}
              onRetry={() => downloadBundle.mutate()}
            />
          </div>
        ) : null}

        {downloadBundle.isSuccess ? (
          <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-2)' }}>
            Transferido. Guarda o ficheiro num sítio seguro — é a tua cópia completa e não
            volta a estar disponível a partir daqui.
          </p>
        ) : null}
      </Card>

      <Card soft>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">Trazer dados de outra aplicação</div>
            <div className="z-card__subtitle">Importar de um CSV ou de uma cópia de segurança</div>
          </div>
        </div>
        <p className="z-small z-muted">
          Se tens o teu histórico noutra aplicação — uma folha de cálculo, um caderno de
          manutenção, o export de um serviço — podes trazê-lo para aqui. O Zemlo percebe as
          colunas sozinho, mostra-te como os registos vão ficar e só escreve depois de tu
          confirmares.
        </p>
        <p className="z-xs z-muted">
          Aceita <strong>CSV</strong> de outra aplicação e o <strong>ZIP</strong> de uma cópia de
          segurança do Zemlo. Nos dois casos, vês o que vai ser escrito antes de algo o ser.
        </p>
        <div className="z-row" style={{ marginTop: 'var(--z-space-3)', gap: 'var(--z-space-2)' }}>
          <ButtonLink to="/import" variant="secondary">
            Importar de um ficheiro
          </ButtonLink>
          <Chip tone="ok">Nada é escrito sem confirmares</Chip>
        </div>
      </Card>

      {download.isError ? (
        <InlineError
          message={errorMessage(download.error)}
          requestId={errorRequestId(download.error)}
          onRetry={() => download.mutate(download.variables ?? 'json')}
        />
      ) : null}

      <Section title="O que está a ser exportado" hint="contadores da tua conta">
        {metrics.isLoading ? <LoadingBlock label="A contar registos…" /> : null}
        {/*
         * O erro desta consulta não era lido: a secção ficava só com o título, sem contadores
         * e sem explicação (`WEB-005`). Não bloqueia a exportação — os botões acima funcionam
         * independentemente destes números —, pelo que o erro fica aqui e não substitui a página.
         */}
        {metrics.isError ? (
          <InlineError
            message={errorMessage(metrics.error)}
            requestId={errorRequestId(metrics.error)}
            onRetry={() => void metrics.refetch()}
          />
        ) : null}
        {metrics.data ? (
          <Card>
            <DetailList>
              <DetailRow label="Veículos" value={formatNumber(metrics.data.account.vehicles, 0)} />
              <DetailRow label="Despesas" value={formatNumber(metrics.data.account.expenses, 0)} />
              <DetailRow label="Abastecimentos" value={formatNumber(metrics.data.account.fuel, 0)} />
              <DetailRow label="Carregamentos" value={formatNumber(metrics.data.account.charging, 0)} />
              <DetailRow label="Manutenções" value={formatNumber(metrics.data.account.maintenance, 0)} />
              <DetailRow label="Documentos" value={formatNumber(metrics.data.account.documents, 0)} />
              <DetailRow label="Lembretes ativos" value={formatNumber(metrics.data.account.activeReminders, 0)} />
              <DetailRow label="Integrações" value={formatNumber(metrics.data.account.integrations, 0)} />
              <DetailRow label="Eventos no histórico" value={formatNumber(metrics.data.account.events, 0)} />
            </DetailList>
          </Card>
        ) : null}
      </Section>

      <Card soft>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">Sobre a privacidade desta operação</div>
          </div>
        </div>
        <p className="z-small z-muted">
          A exportação é registada em auditoria com a data e a origem do pedido — é uma operação
          sobre dados pessoais e tens o direito de a poder identificar mais tarde. Nenhuma
          exportação inclui a tua password, o segredo de verificação em dois passos ou as
          credenciais das integrações: esses valores não fazem parte dos teus dados, fazem parte
          da tua segurança.
        </p>
        {profile.data ? (
          <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-2)' }}>
            Conta <span className="z-mono">{profile.data.email}</span>, criada em{' '}
            {dateLong(profile.data.createdAt.slice(0, 10))}
            {vehicles.data ? ` · ${formatKm((vehicles.data.items ?? []).reduce((sum, vehicle) => sum + (vehicle.odometerKm ?? 0), 0))} km registados` : ''}
          </p>
        ) : null}
        <div className="z-row" style={{ marginTop: 'var(--z-space-3)', gap: 'var(--z-space-2)' }}>
          <Chip tone="ok">Password e 2FA nunca são exportados</Chip>
          <Chip tone="ok">Credenciais de integrações nunca são exportadas</Chip>
        </div>
      </Card>
    </div>
  );
}
