import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { INTEGRATION_CATEGORIES, PROVIDER_KINDS, formatNumber, optionLabel } from '@zemlo/shared';
import {
  useCreateIntegration,
  useDeleteIntegration,
  useIntegrations,
  useUpdateIntegration,
  useVehicles,
} from '../../api/hooks';
import { errorMessage, errorRequestId } from '../../api/errors';
import { ApiError } from '../../api/client';
import { Button, Card, Chip, DetailList, DetailRow, InlineError, LoadingBlock, PageHeader } from '../../ui/primitives';
import { SelectField, TextAreaField, TextField, useFormState } from '../../ui/form';
import { dateLong } from '../../lib/format';

/**
 * Integrações (§26).
 *
 * O ecrã mostra o estado real das integrações e é **explícito sobre o que ainda não existe**.
 * A API já tem o modelo, a cifragem de credenciais em repouso e o registo de sincronização;
 * o que falta são os fornecedores concretos — a API oficial de cada fabricante, o protocolo
 * de cada wallbox, a leitura OBD. Escrever uma lista de "integrações disponíveis" que não
 * ligassem a nada seria vender uma funcionalidade que não existe.
 *
 * As credenciais são enviadas mas **nunca devolvidas**: a resposta traz apenas os *nomes* das
 * chaves guardadas (`credentialKeys`). É por isso que o formulário pede as credenciais em
 * campos de texto simples identificados pelo nome — o Zemlo não tem um esquema por fornecedor
 * para gerar campos tipados, e inventá-lo agora seria adivinhar o que cada API vai exigir.
 */
export function IntegrationsPage() {
  const integrations = useIntegrations();
  const vehicles = useVehicles();
  const create = useCreateIntegration();
  const update = useUpdateIntegration();
  const remove = useDeleteIntegration();

  const [showForm, setShowForm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [credentialKey, setCredentialKey] = useState('apiKey');
  const [credentialValue, setCredentialValue] = useState('');

  const form = useFormState({
    category: 'manufacturer',
    provider: '',
    label: '',
    vehicleId: '',
    configJson: '{}',
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});

    const payload: Record<string, unknown> = {
      category: form.values.category,
      provider: form.values.provider,
      enabled: true,
    };
    const label = form.values.label.trim();
    if (label) payload.label = label;
    if (form.values.vehicleId) payload.vehicleId = form.values.vehicleId;

    // A configuração não sensível vem como texto JSON porque o Zemlo não tem, por
    // fornecedor, um esquema de campos. Um JSON inválido é apanhado aqui, antes de sair,
    // com uma mensagem que explica o que está errado.
    if (form.values.configJson.trim() && form.values.configJson.trim() !== '{}') {
      try {
        payload.config = JSON.parse(form.values.configJson) as Record<string, unknown>;
      } catch {
        setErrors({ config: 'A configuração tem de ser JSON válido (por exemplo {"host": "192.168.1.10"}).' });
        return;
      }
    }
    if (credentialKey.trim() && credentialValue.trim()) {
      payload.credentials = { [credentialKey.trim()]: credentialValue.trim() };
    }

    try {
      await create.mutateAsync(payload);
      setShowForm(false);
      setCredentialValue('');
      form.reset({ category: 'manufacturer', provider: '', label: '', vehicleId: '', configJson: '{}' });
    } catch (error) {
      if (error instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const field of error.fields) map[field.path] = field.message;
        setErrors(map);
      }
    }
  }

  const items = integrations.data?.items ?? [];
  const vehicleById = new Map((vehicles.data?.items ?? []).map((vehicle) => [vehicle.id, vehicle]));

  return (
    <div className="z-page">
      <PageHeader
        title="Integrações"
        subtitle="Ligações a fabricantes, wallboxes, OBD e ao Home Assistant."
        actions={
          <Button variant="highlight" onClick={() => setShowForm((value) => !value)}>
            ＋ Nova integração
          </Button>
        }
      />

      <Card soft>
        <div className="z-card__header">
          <div>
            <div className="z-card__title">Estado desta versão</div>
            <div className="z-card__subtitle">
              O que já funciona e o que ainda depende de credenciais externas
            </div>
          </div>
        </div>
        <ul className="z-stack z-stack--tight z-small">
          <li>
            ✅ <strong>Home Assistant</strong> — a especificação de entidades e as instruções são reais e
            estão disponíveis: <Link to="/integrations/home-assistant">ver o que o Zemlo expõe →</Link>
          </li>
          <li>
            ⏳ <strong>Fabricantes, wallboxes e OBD</strong> — o modelo de dados, a cifragem das credenciais e
            o registo de sincronização existem na API, mas não há um conector por fornecedor
            implementado. Podes registar a integração e as credenciais: ficam cifradas em repouso
            e prontas a usar quando o conector existir.
          </li>
          <li>
            ⏳ <strong>Leitura automática de quilometragem</strong> — depende do conector do fornecedor. Até lá,
            a quilometragem entra pelas leituras manuais e pelos registos de abastecimento e
            carregamento, e o Zemlo diz sempre de onde veio cada valor (§50).
          </li>
        </ul>
      </Card>

      {showForm ? (
        <Card>
          <div className="z-card__header">
            <div className="z-card__title">Nova integração</div>
            <div className="z-card__subtitle">As credenciais são cifradas em repouso e nunca são devolvidas.</div>
          </div>
          <form className="z-stack" onSubmit={onSubmit} noValidate>
            <div className="z-grid z-grid--2">
              <SelectField
                label="Categoria"
                value={form.values.category}
                onChange={(event) => form.setValue('category', event.target.value)}
                options={INTEGRATION_CATEGORIES.map((category) => ({ value: category.code, label: `${category.icon} ${category.label}` }))}
                error={errors.category}
              />
              <TextField
                label="Fornecedor"
                required
                placeholder="kia, tesla, garo, home-assistant…"
                hint="Identificador técnico do conector."
                value={form.values.provider}
                onChange={(event) => form.setValue('provider', event.target.value)}
                error={errors.provider}
              />
            </div>
            <div className="z-grid z-grid--2">
              <TextField
                label="Etiqueta"
                placeholder="O carro do Miguel"
                hint="Como queres ver esta integração na lista."
                value={form.values.label}
                onChange={(event) => form.setValue('label', event.target.value)}
                error={errors.label}
              />
              <SelectField
                label="Veículo"
                placeholder="Sem veículo associado"
                value={form.values.vehicleId}
                onChange={(event) => form.setValue('vehicleId', event.target.value)}
                options={(vehicles.data?.items ?? []).map((vehicle) => ({ value: vehicle.id, label: `${vehicle.emoji} ${vehicle.plateDisplay}` }))}
                error={errors.vehicleId}
              />
            </div>
            <TextAreaField
              label="Configuração (JSON)"
              hint='Não sensível. Exemplo: {"host": "192.168.1.10", "porta": 8123}'
              value={form.values.configJson}
              onChange={(event) => form.setValue('configJson', event.target.value)}
              error={errors.config}
            />
            <div className="z-grid z-grid--2">
              <TextField
                label="Nome da credencial"
                hint="Ex.: apiKey, token, password."
                value={credentialKey}
                onChange={(event) => setCredentialKey(event.target.value)}
              />
              <TextField
                label="Valor da credencial"
                type="password"
                autoComplete="off"
                hint="Guardado cifrado. Nunca volta a ser mostrado."
                value={credentialValue}
                onChange={(event) => setCredentialValue(event.target.value)}
              />
            </div>
            {create.error ? <InlineError message={errorMessage(create.error)} requestId={errorRequestId(create.error)} /> : null}
            <div className="z-row z-row--end" style={{ gap: 'var(--z-space-3)' }}>
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit" variant="primary" loading={create.isPending}>Guardar integração</Button>
            </div>
          </form>
        </Card>
      ) : null}

      {integrations.isLoading ? <LoadingBlock label="A carregar integrações…" /> : null}
      {integrations.isError ? (
        <InlineError
          message={errorMessage(integrations.error)}
          requestId={errorRequestId(integrations.error)}
          onRetry={() => void integrations.refetch()}
        />
      ) : null}

      {integrations.data && items.length === 0 ? (
        <Card>
          <div className="z-empty">
            <span className="z-empty__icon" aria-hidden="true">🔗</span>
            <p className="z-empty__title">Sem integrações ligadas</p>
            <p className="z-empty__body">
              O Zemlo funciona por completo sem integrações — todos os dados entram pelos
              registos que fazes. As integrações servem para reduzir o trabalho manual: leituras
              automáticas de quilometragem, sessões de carregamento importadas da wallbox e
              automações no Home Assistant.
            </p>
            <Button variant="primary" onClick={() => setShowForm(true)}>
              Registar integração
            </Button>
          </div>
        </Card>
      ) : null}

      {items.map((integration) => (
        <Card key={integration.id}>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">
                {integration.label ?? integration.provider}
              </div>
              <div className="z-card__subtitle">
                {optionLabel(INTEGRATION_CATEGORIES, integration.category)} · {integration.provider}
                {integration.vehicleId
                  ? ` · ${vehicleById.get(integration.vehicleId)?.plateDisplay ?? 'veículo'}`
                  : ' · conta inteira'}
              </div>
            </div>
            <Chip tone={integration.enabled ? 'ok' : 'neutral'}>{integration.enabled ? 'Ativa' : 'Desativada'}</Chip>
          </div>

          <DetailList>
            <DetailRow
              label="Estado da sincronização"
              value={
                integration.lastSyncStatus === 'never'
                  ? 'nunca sincronizou'
                  : integration.lastSyncStatus === 'ok'
                    ? 'última sincronização bem-sucedida'
                    : 'última sincronização falhou'
              }
            />
            {integration.lastSyncAt ? (
              <DetailRow label="Última sincronização" value={dateLong(integration.lastSyncAt.slice(0, 10))} />
            ) : null}
            <DetailRow
              label="Credenciais guardadas"
              value={integration.credentialKeys.length === 0 ? 'nenhuma' : integration.credentialKeys.join(', ')}
            />
            {Object.keys(integration.config).length > 0 ? (
              <DetailRow label="Configuração" value={Object.keys(integration.config).join(', ')} />
            ) : null}
          </DetailList>

          {integration.lastSyncMessage ? (
            <p className="z-small z-muted" style={{ marginTop: 'var(--z-space-2)' }}>
              {integration.lastSyncMessage}
            </p>
          ) : null}

          <div className="z-row z-row--wrap" style={{ gap: 'var(--z-space-2)', marginTop: 'var(--z-space-3)' }}>
            <Button
              variant="secondary"
              size="sm"
              loading={update.isPending}
              onClick={() =>
                void update.mutateAsync({ integrationId: integration.id, payload: { enabled: !integration.enabled } })
              }
            >
              {integration.enabled ? 'Desativar' : 'Ativar'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (window.confirm('Eliminar esta integração? As credenciais associadas são removidas.')) {
                  void remove.mutateAsync(integration.id);
                }
              }}
            >
              Eliminar
            </Button>
          </div>
        </Card>
      ))}

      <Card soft>
        <div className="z-card__row" style={{ display: 'flex', gap: 'var(--z-space-3)', flexWrap: 'wrap' }}>
          <Link to="/integrations/home-assistant" className="z-btn z-btn--primary">
            🏠 Especificação do Home Assistant
          </Link>
          <span className="z-small z-muted" style={{ alignSelf: 'center' }}>
            Entidades, requisitos e instruções — {formatNumber(PROVIDER_KINDS.length, 0)} origens de dados
            suportadas pelo contrato.
          </span>
        </div>
      </Card>
    </div>
  );
}
