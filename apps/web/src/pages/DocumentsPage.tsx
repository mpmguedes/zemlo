import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { DOCUMENT_CATEGORIES, optionLabel } from '@zemlo/shared';
import { useCreateDocument, useDocuments, useVehicles } from '../api/hooks';
import { errorMessage, errorRequestId } from '../api/errors';
import { ApiError } from '../api/client';
import { Button, Card, Chip, InlineError, LoadingBlock, PageHeader, Section } from '../ui/primitives';
import { DateField, SelectField, TextAreaField, TextField, useFormState } from '../ui/form';
import { RecordsEmptyState } from '../components/records';
import { dateLong, relativeDate } from '../lib/format';
import { textOrUndefined } from '../lib/formPayload';
import { useToast } from '../ui/Toaster';

/**
 * Documentos (§17).
 *
 * A lista mostra o que existe e liga ao detalhe de cada documento, onde se edita e se
 * transfere o ficheiro. A distinção é deliberada: a lista é para varrer, o detalhe é para
 * agir sobre um documento — e "Descarregar" e "Eliminar" não devem ficar a um clique de
 * distância uma da outra.
 *
 * O que continua a **não** existir é o carregamento de ficheiros: este ecrã cria o
 * registo e os metadados, e a transferência serve ficheiros que já estejam no
 * armazenamento (por exemplo, vindos de uma importação). Não há um `<input type="file">` a
 * fingir que faz mais do que isso (§49, §59).
 */
export function DocumentsPage() {
  const vehicles = useVehicles();
  const documents = useDocuments(undefined, 200);
  const create = useCreateDocument();
  const toast = useToast();

  const [showForm, setShowForm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [vehicleFilter, setVehicleFilter] = useState('');

  const form = useFormState({
    name: '',
    category: 'registration',
    vehicleId: '',
    date: '',
    expiresAt: '',
    fileName: '',
    notes: '',
  });

  const items = (documents.data?.items ?? []).filter((document) =>
    vehicleFilter === '' ? true : vehicleFilter === 'none' ? document.vehicleId === null : document.vehicleId === vehicleFilter,
  );

  const vehicleById = new Map((vehicles.data?.items ?? []).map((vehicle) => [vehicle.id, vehicle]));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    const payload: Record<string, unknown> = {
      name: form.values.name,
      category: form.values.category,
    };
    if (form.values.vehicleId) payload.vehicleId = form.values.vehicleId;
    const date = textOrUndefined(form.values.date);
    if (date) payload.date = date;
    const expiresAt = textOrUndefined(form.values.expiresAt);
    if (expiresAt) payload.expiresAt = expiresAt;
    const fileName = textOrUndefined(form.values.fileName);
    if (fileName) payload.fileName = fileName;
    const notes = textOrUndefined(form.values.notes);
    if (notes) payload.notes = notes;

    try {
      await create.mutateAsync(payload);
      setShowForm(false);
      form.reset({
        name: '',
        category: 'registration',
        vehicleId: form.values.vehicleId,
        date: '',
        expiresAt: '',
        fileName: '',
        notes: '',
      });
      toast.show('Documento guardado.', { variant: 'ok' });
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
        title="Documentos"
        subtitle="Documento Único, apólices, certificados e faturas — com validade vigiada."
        actions={
          <Button variant="highlight" onClick={() => setShowForm((value) => !value)}>
            ＋ Novo documento
          </Button>
        }
      />

      <Card soft>
        <p className="z-small z-muted">
          Abre um documento para ver os metadados, corrigir a validade e transferir o ficheiro.
          Este ecrã regista documentos; o carregamento de ficheiros novos para o armazenamento
          ainda não está ligado.
        </p>
      </Card>

      {showForm ? (
        <Card>
          <div className="z-card__header">
            <div className="z-card__title">Novo documento</div>
          </div>
          <form className="z-stack" onSubmit={onSubmit} noValidate>
            <TextField
              label="Nome"
              required
              autoFocus
              placeholder="Apólice de seguro 2026/2027"
              value={form.values.name}
              onChange={(event) => form.setValue('name', event.target.value)}
              error={errors.name}
            />
            <div className="z-grid z-grid--2">
              <SelectField
                label="Categoria"
                value={form.values.category}
                onChange={(event) => form.setValue('category', event.target.value)}
                options={DOCUMENT_CATEGORIES.map((category) => ({ value: category.code, label: `${category.icon} ${category.label}` }))}
                error={errors.category}
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
            <div className="z-grid z-grid--2">
              <DateField label="Data do documento" value={form.values.date} onChange={(event) => form.setValue('date', event.target.value)} error={errors.date} />
              <DateField
                label="Validade"
                hint="Com validade, o Zemlo avisa-te antes de expirar."
                value={form.values.expiresAt}
                onChange={(event) => form.setValue('expiresAt', event.target.value)}
                error={errors.expiresAt}
              />
            </div>
            <div className="z-grid z-grid--2">
              <TextField
                label="Nome do ficheiro"
                placeholder="apolice-2026.pdf"
                hint="Só o nome — o ficheiro é associado pela importação."
                value={form.values.fileName}
                onChange={(event) => form.setValue('fileName', event.target.value)}
                error={errors.fileName}
              />
              <DateField
                label="Validade"
                hint="Com validade, o Zemlo avisa-te antes de expirar."
                value={form.values.expiresAt}
                onChange={(event) => form.setValue('expiresAt', event.target.value)}
                error={errors.expiresAt}
              />
            </div>
            <TextAreaField label="Notas" value={form.values.notes} onChange={(event) => form.setValue('notes', event.target.value)} />
            {create.error ? <InlineError message={errorMessage(create.error)} requestId={errorRequestId(create.error)} /> : null}
            <div className="z-row z-row--end" style={{ gap: 'var(--z-space-3)' }}>
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit" variant="primary" loading={create.isPending}>Guardar documento</Button>
            </div>
          </form>
        </Card>
      ) : null}

      {documents.isLoading ? <LoadingBlock label="A carregar documentos…" /> : null}
      {documents.isError ? (
        <InlineError
          message={errorMessage(documents.error)}
          requestId={errorRequestId(documents.error)}
          onRetry={() => void documents.refetch()}
        />
      ) : null}

      {documents.data && documents.data.items.length > 0 ? (
        <>
          <div className="z-filters">
            <Chip tone={vehicleFilter === '' ? 'accent' : 'neutral'}>
              <button type="button" onClick={() => setVehicleFilter('')} style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}>
                Todos
              </button>
            </Chip>
            {(vehicles.data?.items ?? []).map((vehicle) => (
              <Chip key={vehicle.id} tone={vehicleFilter === vehicle.id ? 'accent' : 'neutral'}>
                <button
                  type="button"
                  onClick={() => setVehicleFilter(vehicle.id)}
                  style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}
                >
                  {vehicle.emoji} {vehicle.plateDisplay}
                </button>
              </Chip>
            ))}
            {documents.data.items.some((document) => document.vehicleId === null) ? (
              <Chip tone={vehicleFilter === 'none' ? 'accent' : 'neutral'}>
                <button
                  type="button"
                  onClick={() => setVehicleFilter('none')}
                  style={{ background: 'transparent', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', minHeight: 'var(--z-touch)' }}
                >
                  Sem veículo
                </button>
              </Chip>
            ) : null}
          </div>

          <Section title={`${items.length} documentos`}>
            <Card flush>
              <div className="z-list">
              {items.map((document) => {
                const vehicle = document.vehicleId ? vehicleById.get(document.vehicleId) : null;
                return (
                  <div className="z-list__item" key={document.id}>
                    <span className="z-list__icon" aria-hidden="true">
                      {DOCUMENT_CATEGORIES.find((category) => category.code === document.category)?.icon ?? '📄'}
                    </span>
                    <span className="z-list__body">
                      <span className="z-list__title">{document.name}</span>
                      <span className="z-list__meta">
                        {optionLabel(DOCUMENT_CATEGORIES, document.category)}
                        {vehicle ? ` · ${vehicle.plateDisplay}` : ' · sem veículo'}
                        {document.date ? ` · ${dateLong(document.date)}` : ''}
                      </span>
                      {document.fileName ? <span className="z-list__meta">{document.fileName}</span> : null}
                    </span>
                    <span className="z-list__trailing">
                      {document.expiresAt ? (
                        <Chip tone={(document.daysToExpiry ?? 0) < 0 ? 'danger' : (document.daysToExpiry ?? 0) <= 60 ? 'warn' : 'ok'}>
                          {relativeDate(document.expiresAt)}
                        </Chip>
                      ) : (
                        <span className="z-xs z-muted">sem validade</span>
                      )}
                      {/*
                       * Sem botão "Eliminar" aqui: eliminar é irreversível e não pertence a
                       * uma linha de lista, ao lado de um alvo de toque. Vive no detalhe,
                       * depois do ficheiro e dos metadados.
                       */}
                      <Link to={`/documents/${document.id}`} className="z-btn z-btn--ghost z-btn--sm">
                        Abrir →
                      </Link>
                    </span>
                  </div>
                );
              })}
              </div>
            </Card>
          </Section>
        </>
      ) : null}

      {documents.data && items.length === 0 ? (
        <RecordsEmptyState
          icon="📄"
          title={documents.data.items.length === 0 ? 'Sem documentos guardados' : 'Nada neste filtro'}
          body={
            documents.data.items.length === 0
              ? 'Guarda aqui o Documento Único Automóvel, as apólices e os certificados. Com validade preenchida, o Zemlo avisa-te antes de expirarem.'
              : 'Nenhum documento corresponde ao veículo escolhido.'
          }
          onAdd={() => setShowForm(true)}
          addLabel="Guardar documento"
        />
      ) : null}

      <p className="z-xs z-muted">
        Os documentos sem veículo associado existem para o que não pertence a um carro em
        particular — por exemplo, uma fatura conjunta ou um comprovativo de portagens.{' '}
        <Link to="/vehicles">Gerir veículos →</Link>
      </p>
    </div>
  );
}
