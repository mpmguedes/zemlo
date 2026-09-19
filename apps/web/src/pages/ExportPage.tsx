import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { formatKm, todayIn } from '@zemlo/shared';
import { fetchExport } from '../api/queries';
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
 * **diferença entre os dois formatos** e diz o que cada um serve.
 *
 *  - **JSON** — cópia fiel e completa, com `meta.formatVersion`, pensada para reimportação e
 *    para quem quer processar os dados. Dinheiro em cêntimos, datas civis em `YYYY-MM-DD`:
 *    os mesmos tipos do contrato, sem arredondamentos pelo caminho.
 *  - **CSV** — uma secção por tipo de registo, com separador `;`, vírgula decimal e BOM
 *    UTF-8. O BOM não é um detalhe: sem ele, o Excel em português abre o ficheiro a mostrar
 *    `Ã§Ã£o` em vez de `ção`, e o utilizador conclui que a exportação está avariada. A API
 *    também protege contra injeção de fórmulas — um campo que comece por `=` não é executado
 *    ao abrir a folha.
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

      <Card soft>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">Trazer dados de outra aplicação</div>
            <div className="z-card__subtitle">Importar de um ficheiro CSV</div>
          </div>
        </div>
        <p className="z-small z-muted">
          Se tens o teu histórico noutra aplicação — uma folha de cálculo, um caderno de
          manutenção, o export de um serviço — podes trazê-lo para aqui. O Zemlo percebe as
          colunas sozinho, mostra-te como os registos vão ficar e só escreve depois de tu
          confirmares.
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
