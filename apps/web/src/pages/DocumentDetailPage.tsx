import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DOCUMENT_CATEGORIES, optionLabel } from '@zemlo/shared';
import {
  useDeleteDocument,
  useDocument,
  useDownloadDocument,
  useUpdateDocument,
  useVehicles,
} from '../api/hooks';
import { errorMessage, errorRequestId } from '../api/errors';
import { ApiError, saveBlob } from '../api/client';
import {
  Button,
  Card,
  Chip,
  DetailList,
  DetailRow,
  InlineError,
  LoadingBlock,
  PageHeader,
  Section,
} from '../ui/primitives';
import { DateField, SelectField, TextAreaField, TextField, useFormState } from '../ui/form';
import { dateLong, formatBytes, relativeDate } from '../lib/format';
import { textOrUndefined } from '../lib/formPayload';
import { useToast } from '../ui/Toaster';

/**
 * Detalhe de um documento (§17).
 *
 * ## Porque é que existe uma página, e não uma linha expansível na lista
 *
 * O documento tem dois atributos que só se lêem bem com espaço: o **estado de validade**
 * (que depende da data de hoje e do fuso do utilizador) e a **transferência do ficheiro**,
 * que é uma ação com consequências. Numa linha da lista, a ação "Descarregar" ficaria ao
 * lado de "Eliminar" — e um clique errado entre as duas é irreversível. Aqui há separação.
 *
 * ## O que este ecrã assume
 *
 * O ficheiro **existe** e pode ser transferido: é isso que a presença de `storageKey`
 * significa, e o botão só aparece quando ela existe. Se estiver gravada mas os bytes já não
 * estiverem no armazenamento, a API responde 404 com uma mensagem própria e o erro é
 * apresentado junto ao botão, em vez de substituir a página — o resto dos metadados
 * continua a ser legítimo e editável.
 *
 * `storageKey` **não é mostrada**. Era um campo editável no formulário de criação; aqui é
 * uma referência interna, e expô-la só convidava a editá-la à mão, que é a única forma de
 * partir a ligação entre o registo e o ficheiro.
 */
export function DocumentDetailPage() {
  const { documentId = '' } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const document = useDocument(documentId);
  const vehicles = useVehicles();
  const update = useUpdateDocument(documentId);
  const remove = useDeleteDocument();
  const transfer = useDownloadDocument();
  const toast = useToast();

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const form = useFormState({
    name: '',
    category: 'registration',
    vehicleId: '',
    date: '',
    expiresAt: '',
    notes: '',
  });

  const data = document.data;

  /*
   * Sincronizar o formulário com o documento recebido. Os valores da API são a fonte de
   * verdade até o utilizador os alterar; sem isto, um `refetch` (por exemplo ao voltar ao
   * separador) sobrescreveria edições por gravar, ou deixaria o formulário com os valores
   * antigos depois de um `Guardar` bem sucedido.
   */
  useEffect(() => {
    if (!data) return;
    form.reset({
      name: data.name,
      category: data.category,
      vehicleId: data.vehicleId ?? '',
      date: data.date ?? '',
      expiresAt: data.expiresAt ?? '',
      notes: data.notes ?? '',
    });
    setErrors({});
    setDirty(false);
    // `form.reset` é estável; `data` é a dependência real.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (document.isLoading) return <LoadingBlock label="A carregar o documento…" />;

  if (document.isError) {
    return (
      <div className="z-page">
        <PageHeader title="Documento" back={{ to: '/documents', label: 'Documentos' }} />
        <InlineError
          message={errorMessage(document.error)}
          requestId={errorRequestId(document.error)}
          onRetry={() => void document.refetch()}
        />
      </div>
    );
  }

  if (!data) return null;

  const vehicle = data.vehicleId
    ? (vehicles.data?.items ?? []).find((item) => item.id === data.vehicleId) ?? null
    : null;
  const icon = DOCUMENT_CATEGORIES.find((category) => category.code === data.category)?.icon ?? '📄';
  const hasFile = typeof data.storageKey === 'string' && data.storageKey.length > 0;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    const payload: Record<string, unknown> = {
      name: form.values.name,
      category: form.values.category,
    };
    // `null` explícito para o que foi limpo: o `PATCH` distingue "não mexer" (campo ausente)
    // de "apagar" (campo a `null`), e omitir o campo deixaria a data antiga no registo.
    payload.vehicleId = textOrUndefined(form.values.vehicleId) ?? null;
    payload.date = textOrUndefined(form.values.date) ?? null;
    payload.expiresAt = textOrUndefined(form.values.expiresAt) ?? null;
    payload.notes = textOrUndefined(form.values.notes) ?? null;

    try {
      await update.mutateAsync(payload);
      setDirty(false);
      toast.show('Alterações guardadas.', { variant: 'ok' });
    } catch (error) {
      if (error instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const field of error.fields) map[field.path] = field.message;
        setErrors(map);
      }
    }
  }

  return (
    <div className="z-page">
      <PageHeader
        title={data.name}
        subtitle={
          <span className="z-row z-row--wrap" style={{ gap: 'var(--z-space-2)' }}>
            <span>
              {icon} {optionLabel(DOCUMENT_CATEGORIES, data.category)}
            </span>
            {vehicle ? <span>· {vehicle.emoji} {vehicle.plateDisplay}</span> : <span>· sem veículo</span>}
          </span>
        }
        back={{ to: '/documents', label: 'Documentos' }}
        actions={
          <Button
            variant="highlight"
            disabled={!hasFile}
            loading={transfer.isPending}
            onClick={() => {
              void transfer
                .mutateAsync(data.id)
                .then(({ blob, fileName }) => {
                  // O nome já vem sanitizado da API; o fallback só existe para o caso de um
                  // proxy (ou um cliente antigo) não deixar passar o cabeçalho.
                  saveBlob(blob, fileName ?? data.fileName ?? 'documento');
                  toast.show('Documento transferido.', { variant: 'ok' });
                })
                .catch(() => undefined);
            }}
          >
            ⬇ Descarregar
          </Button>
        }
      />

      {/*
       * O erro da transferência fica aqui, e não substitui a página: o que falhou foi o
       * ficheiro, e os metadados abaixo continuam a ser verdadeiros e editáveis.
       */}
      {transfer.isError ? (
        <InlineError
          message={errorMessage(transfer.error)}
          requestId={errorRequestId(transfer.error)}
        />
      ) : null}

      {!hasFile ? (
        <Card soft>
          <p className="z-small z-muted">
            Este documento tem metadados mas não tem ficheiro associado, pelo que não há nada
            para transferir. É o caso dos documentos registados à mão, só para vigiar a validade.
          </p>
        </Card>
      ) : null}

      <Card>
        <Section title="Ficheiro">
          <DetailList>
            <DetailRow label="Nome do ficheiro" value={data.fileName ?? '—'} />
            <DetailRow label="Tipo" value={data.mimeType ?? '—'} />
            <DetailRow
              label="Tamanho"
              value={typeof data.sizeBytes === 'number' ? formatBytes(data.sizeBytes) : '—'}
            />
            <DetailRow
              label="Validade"
              value={
                data.expiresAt ? (
                  <span className="z-row" style={{ gap: 'var(--z-space-2)', justifyContent: 'flex-end' }}>
                    <span>{dateLong(data.expiresAt)}</span>
                    <Chip
                      tone={
                        (data.daysToExpiry ?? 0) < 0
                          ? 'danger'
                          : (data.daysToExpiry ?? 0) <= 60
                            ? 'warn'
                            : 'ok'
                      }
                    >
                      {relativeDate(data.expiresAt)}
                    </Chip>
                  </span>
                ) : (
                  '—'
                )
              }
            />
          </DetailList>
          <p className="z-xs z-muted" style={{ marginTop: 'var(--z-space-3)' }}>
            O ficheiro é servido pela API apenas a quem tem sessão iniciada nesta conta. Não
            existe endereço público nem link partilhável.
          </p>
        </Section>
      </Card>

      <Card>
        <div className="z-card__header">
          <div className="z-card__title">Metadados</div>
          {dirty ? <span className="z-xs z-muted">Por guardar</span> : null}
        </div>
        <form className="z-stack" onSubmit={onSubmit} noValidate>
          <TextField
            label="Nome"
            required
            value={form.values.name}
            onChange={(event) => {
              form.setValue('name', event.target.value);
              setDirty(true);
            }}
            error={errors.name}
          />
          <div className="z-grid z-grid--2">
            <SelectField
              label="Categoria"
              value={form.values.category}
              onChange={(event) => {
                form.setValue('category', event.target.value);
                setDirty(true);
              }}
              options={DOCUMENT_CATEGORIES.map((category) => ({
                value: category.code,
                label: `${category.icon} ${category.label}`,
              }))}
              error={errors.category}
            />
            <SelectField
              label="Veículo"
              placeholder="Sem veículo associado"
              value={form.values.vehicleId}
              onChange={(event) => {
                form.setValue('vehicleId', event.target.value);
                setDirty(true);
              }}
              options={(vehicles.data?.items ?? []).map((item) => ({
                value: item.id,
                label: `${item.emoji} ${item.plateDisplay}`,
              }))}
              error={errors.vehicleId}
            />
          </div>
          <div className="z-grid z-grid--2">
            <DateField
              label="Data do documento"
              value={form.values.date}
              onChange={(event) => {
                form.setValue('date', event.target.value);
                setDirty(true);
              }}
              error={errors.date}
            />
            <DateField
              label="Validade"
              hint="Com validade, o Zemlo avisa-te antes de expirar."
              value={form.values.expiresAt}
              onChange={(event) => {
                form.setValue('expiresAt', event.target.value);
                setDirty(true);
              }}
              error={errors.expiresAt}
            />
          </div>
          <TextAreaField
            label="Notas"
            value={form.values.notes}
            onChange={(event) => {
              form.setValue('notes', event.target.value);
              setDirty(true);
            }}
          />
          {update.error ? (
            <InlineError message={errorMessage(update.error)} requestId={errorRequestId(update.error)} />
          ) : null}
          <div className="z-row z-row--end" style={{ gap: 'var(--z-space-3)' }}>
            <Button
              variant="secondary"
              disabled={!dirty || update.isPending}
              onClick={() => {
                form.reset({
                  name: data.name,
                  category: data.category,
                  vehicleId: data.vehicleId ?? '',
                  date: data.date ?? '',
                  expiresAt: data.expiresAt ?? '',
                  notes: data.notes ?? '',
                });
                setErrors({});
                setDirty(false);
              }}
            >
              Descartar
            </Button>
            <Button type="submit" variant="primary" loading={update.isPending} disabled={!dirty}>
              Guardar
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="z-card__header">
          <div className="z-card__title">Eliminar</div>
        </div>
        <p className="z-small z-muted">
          Elimina os metadados e a ligação ao ficheiro. O ficheiro em si continua no
          armazenamento — removê-lo é uma operação de armazenamento, não de registo.
        </p>
        <div className="z-row z-row--end">
          <Button
            variant="ghost"
            loading={remove.isPending}
            onClick={() => {
              if (!window.confirm('Eliminar este documento? Os metadados são removidos; o ficheiro no armazenamento não.')) return;
              void remove.mutateAsync(data.id).then(() => {
                toast.show('Documento eliminado.', { variant: 'ok' });
                navigate('/documents');
              });
            }}
          >
            Eliminar documento
          </Button>
        </div>
      </Card>

      <p className="z-xs z-muted">
        <Link to="/documents">← Voltar aos documentos</Link>
      </p>
    </div>
  );
}
