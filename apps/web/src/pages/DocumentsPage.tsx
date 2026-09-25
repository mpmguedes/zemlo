import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { DOCUMENT_CATEGORIES, optionLabel } from '@zemlo/shared';
import { useCreateDocument, useDocuments, useVehicles } from '../api/hooks';
import { errorMessage, errorRequestId } from '../api/errors';
import { ApiError } from '../api/client';
import { Button, Card, Chip, InlineError, LoadingBlock, PageHeader, Section } from '../ui/primitives';
import { DateField, SelectField, TextAreaField, TextField, useFormState } from '../ui/form';
import { RecordsEmptyState } from '../components/records';
import { LocalSearch } from '../ui/LocalSearch';
import { filterByQuery, searchScopeNote } from '../lib/localSearch';
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
 * O que continua a **não** existir **neste ecrã** é o envio de ficheiros: a lista cria o
 * registo e os metadados, e a transferência serve ficheiros que já estejam no
 * armazenamento (por exemplo, vindos de uma importação). A API já **aceita** o envio de
 * bytes (`POST /documents/:id/content`, §A31), mas este ecrã não tem `<input type="file">`
 * — e não se finge que tem, que é a razão de o aviso abaixo ser explícito (§49, §59).
 */
export function DocumentsPage() {
  const vehicles = useVehicles();
  const documents = useDocuments(undefined, 200);
  const create = useCreateDocument();
  const toast = useToast();

  const [showForm, setShowForm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [query, setQuery] = useState('');

  const form = useFormState({
    name: '',
    category: 'registration',
    vehicleId: '',
    date: '',
    expiresAt: '',
    fileName: '',
    notes: '',
  });

  const vehicleById = new Map((vehicles.data?.items ?? []).map((vehicle) => [vehicle.id, vehicle]));

  /*
   * Dois filtros locais, em sequência: primeiro o veículo (que é o filtro «estrutural» do ecrã),
   * depois a pesquisa textual. A ordem importa para a mensagem: «mostrar N de M» conta a partir
   * do que sobrou do filtro de veículo, e é isso que o utilizador vê na lista.
   *
   * `loaded` é o número de documentos depois do filtro de veículo — o universo real da pesquisa,
   * porque o que foi escondido pelo veículo não é «não procurado por falta de carregamento», é
   * simplesmente fora do filtro atual. `total` é o que a lista carregou por inteiro (`limit 200`),
   * o que faz o aviso de âmbito dizer que a pesquisa vê **todos** os resultados deste ecrã.
   */
  const loadedItems = (documents.data?.items ?? []).filter((document) =>
    vehicleFilter === '' ? true : vehicleFilter === 'none' ? document.vehicleId === null : document.vehicleId === vehicleFilter,
  );

  const items = filterByQuery(loadedItems, query, (document) => [
    document.name,
    optionLabel(DOCUMENT_CATEGORIES, document.category),
    document.fileName,
    document.notes,
    vehicleById.get(document.vehicleId ?? '')?.plateDisplay,
    vehicleById.get(document.vehicleId ?? '')?.nickname,
  ]);

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
          Este ecrã regista documentos. O envio de ficheiros novos ainda não está disponível
          aqui: a API já o aceita, mas este ecrã ainda não tem um controlo para o fazer.
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
            {/*
              «Nome do ficheiro» ocupa a linha inteira.

              Estava num par `z-grid--2` com um **segundo** campo «Validade» — o duplicado de
              `WEB-009`, que ficou para trás quando a validade passou para o par com a data
              (logo acima). Removido o duplicado, o par ficava com um filho só: um campo a meia
              largura ao lado de nada. A grelha sai com ele.
            */}
            <TextField
              label="Nome do ficheiro"
              placeholder="apolice-2026.pdf"
              hint="Só o nome — o ficheiro é associado pela importação."
              value={form.values.fileName}
              onChange={(event) => form.setValue('fileName', event.target.value)}
              error={errors.fileName}
            />
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
          {/*
            `role="group"` + `aria-label` (uniformização de `WEB-007`): a fila de chips é um
            grupo de controlos que filtram a lista, e sem nome um leitor de ecrã anuncia oito
            botões soltos sem dizer de que escolha fazem parte. A guarda de `WEB-006` em
            `accessibility.test.tsx` passa a apanhar este grupo — antes não o via porque não
            tinha `role="group"`.
          */}
          <div className="z-filters" role="group" aria-label="Filtrar documentos por veículo">
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

          {/*
            A pesquisa vive **fora** do `z-filters`: aquele é a fila horizontal de chips, esta é
            um campo de texto com o seu rótulo e o aviso de âmbito. Misturá-los poria um `<input>`
            a deslizar com os chips.

            Aparece com `loadedItems.length > 0` (e não `items.length`): quando a pesquisa esvazia
            a lista, o campo tem de **continuar** visível — é o único caminho de volta, e esconder
            o campo com o texto de pesquisa lá dentro prenderia o utilizador num ecrã vazio.

            O âmbito (`scopeNote`) conta `loadedItems.length` de `documents.data.items.length`: o
            ecrã carrega a lista por inteiro (`limit 200`), pelo que o aviso diz que a pesquisa vê
            todos os resultados — o veículo escondido pelo filtro de chips não é «não carregado»,
            e por isso não entra na frase do que falta carregar.
          */}
          {loadedItems.length > 0 ? (
            <LocalSearch
              value={query}
              onChange={setQuery}
              label="Pesquisar documentos"
              placeholder="Nome, categoria, ficheiro, notas…"
              scopeNote={searchScopeNote(loadedItems.length, documents.data.items.length)}
              matched={items.length}
              loaded={loadedItems.length}
            />
          ) : null}

          {items.length > 0 ? (
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
          ) : null}

          {/*
            Estados vazios, em três casos distintos — e a distinção é o que evita mentir ao
            utilizador. «Sem documentos guardados» é a conta vazia; «nada neste filtro» é o
            filtro de veículo a esconder tudo; «nada corresponde à pesquisa» é a pesquisa a
            não encontrar — e este último precisa de dizer o texto procurado, para que o
            utilizador perceba que o filtro é que agiu, e não a lista que está vazia.
          */}
          {items.length === 0 ? (
            <RecordsEmptyState
              icon="📄"
              title={
                documents.data.items.length === 0
                  ? 'Sem documentos guardados'
                  : query.trim() !== ''
                    ? 'Nada corresponde à pesquisa'
                    : 'Nada neste filtro'
              }
              body={
                documents.data.items.length === 0
                  ? 'Guarda aqui o Documento Único Automóvel, as apólices e os certificados. Com validade preenchida, o Zemlo avisa-te antes de expirarem.'
                  : query.trim() !== ''
                    ? `A pesquisa por «${query.trim()}» não encontrou documentos nesta lista. A pesquisa atua apenas sobre os ${loadedItems.length} documentos já carregados.`
                    : 'Nenhum documento corresponde ao veículo escolhido.'
              }
              {...(documents.data.items.length === 0
                ? { onAdd: () => setShowForm(true), addLabel: 'Guardar documento' }
                : {})}
            />
          ) : null}
        </>
      ) : null}

      <p className="z-xs z-muted">
        Os documentos sem veículo associado existem para o que não pertence a um carro em
        particular — por exemplo, uma fatura conjunta ou um comprovativo de portagens.{' '}
        <Link to="/vehicles">Gerir veículos →</Link>
      </p>
    </div>
  );
}
