import { useCallback, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Card, Chip, Disclosure, InlineError, PageHeader } from '../../ui/primitives';
import { useToast } from '../../ui/Toaster';
import { errorMessage, errorRequestId } from '../../api/errors';
import { applyCsvImport, previewCsvImport } from '../../api/queries';
import type { ColumnDecision, CsvApplyResponse, CsvPreviewResponse, DateOrder, DecimalStyle, RecordKind } from '../../api/queries';
import { DetectionStep } from './DetectionStep';
import { BundleImportFlow } from './BundleImportFlow';
import { Dropzone, type ChosenKind } from './Dropzone';
import { KindStep } from './KindStep';
import { MappingStep } from './MappingStep';
import { PlanStep } from './PlanStep';
import { PreviewStep } from './PreviewStep';
import { ReportStep } from './ReportStep';
import { Steps } from './Steps';
import { recordKindOptions } from './kinds';

/**
 * Importar dados de um ficheiro CSV (§10, §11).
 *
 * ## O contrato que este ecrã cumpre
 *
 * A §7.1 proíbe qualquer escrita antes de o utilizador confirmar, e a §11.3 exige que "nada
 * acontece sem o utilizador ver o que vai acontecer". Este ecrã é a materialização das duas
 * coisas: **nada é escrito até ao último passo**, e cada passo mostra o que o servidor
 * percebeu antes de o utilizar.
 *
 * ## As nove fases da §10.2, num ecrã
 *
 * O ecrã avança por fases, mas não obriga a nove cliques. As fases 1–3 (envio, deteção,
 * mapeamento automático) acontecem num **único pedido** — a análise — e o resultado é
 * apresentado de uma vez. Só as fases que exigem uma decisão (confirmar o tipo, corrigir uma
 * coluna, confirmar uma convenção) se tornam passos próprios. Um ficheiro limpo, com
 * cabeçalhos reconhecidos e uma conta vazia, percorre o ecrã em dois gestos: escolher o
 * ficheiro e carregar em "Importar".
 *
 * ## Porque é que o ficheiro é reenviado no `apply`
 *
 * O `apply` **reanalisa os bytes** em vez de confiar no plano que recebe — é essa a defesa,
 * do lado do servidor, contra "o plano não é deste ficheiro". Reenviar o mesmo `File` é, por
 * isso, a única forma de a identidade (`sha256` dos bytes) coincidir entre a análise e a
 * escrita. O `identity.key` viaja também, para que o servidor possa **recusar** (409) um
 * plano que já não corresponda ao que recebeu, em vez de escrever outra coisa.
 *
 * ## Porque é que não se guarda o plano no estado
 *
 * O plano que governa a escrita é sempre o que o servidor acabou de construir a partir dos
 * bytes. Guardá-lo aqui e reenviá-lo daria a ilusão de que o cliente decide o que é escrito —
 * a API aceita-o apenas para o confrontar. Cada reanálise substitui a anterior por inteiro.
 */

/** O estado do fluxo. Cada valor corresponde a um passo visível. */
type Phase = 'escolher' | 'analisar' | 'tipo' | 'mapear' | 'rever' | 'relatorio';

interface AnalysisInput {
  file: File;
  kind: RecordKind | null;
  decisions: Array<[number, string | null]>;
  dateOrder: DateOrder | null;
  decimalStyle: DecimalStyle | null;
}

export function CsvImportPage() {
  const toast = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('escolher');

  /**
   * Que pipeline está a tratar o ficheiro escolhido.
   *
   * `null` enquanto nada foi escolhido. A partir daí, é o que decide qual dos dois fluxos
   * desenha o ecrã — e é `null` que faz a Dropzone aparecer.
   *
   * ## Porque é que a escolha é feita uma vez e não a cada render
   *
   * A classificação (`classifyFile`) olha para o nome e o MIME do ficheiro, e ambos são
   * estáveis enquanto o ficheiro for o mesmo. Recalculá-la a cada render daria o mesmo
   * resultado, mas criaria a ilusão de que o ecrã pode mudar de pipeline sozinho — e um
   * ecrã que muda de fluxo sem o utilizador pedir é exatamente o que torna uma importação
   * imprevisível. Fixá-la na escolha torna a transição explícita.
   */
  const [chosenKind, setChosenKind] = useState<ChosenKind | null>(null);

  /** O resultado da última análise. Tudo o que os passos mostram vem daqui. */
  const [analysis, setAnalysis] = useState<CsvPreviewResponse | null>(null);
  const [report, setReport] = useState<CsvApplyResponse | null>(null);

  /* Decisões do utilizador. */
  const [kind, setKind] = useState<RecordKind | null>(null);
  const [decisions, setDecisions] = useState<Map<number, string | null>>(new Map());
  const [dateOrder, setDateOrder] = useState<DateOrder | null>(null);
  const [decimalStyle, setDecimalStyle] = useState<DecimalStyle | null>(null);

  /**
   * Contador de análises.
   *
   * Cada análise substitui a anterior por inteiro. Sem isto, uma resposta antiga que chegasse
   * depois de uma nova — o utilizador corrigiu uma coluna enquanto a primeira análise ainda
   * corria — sobrescreveria a mais recente com dados desatualizados, e o ecrã passaria a
   * mostrar um mapeamento que já não corresponde às decisões tomadas.
   *
   * A guarda vive no `onSuccess`, comparando o número do pedido que **originou** aquela
   * resposta com o último pedido emitido. Usa-se `variables` e não um campo extra no corpo:
   * o corpo é o contrato com a API e não deve transportar estado do cliente.
   */
  const latest = useRef(0);

  const analyse = useMutation({
    mutationFn: (input: AnalysisInput) => {
      const payload: ColumnDecision[] = input.decisions.map(([index, field]) => ({ index, field }));
      return previewCsvImport(input.file, {
        ...(input.kind !== null ? { kind: input.kind } : {}),
        ...(payload.length > 0 ? { decisions: payload } : {}),
        ...(input.dateOrder !== null ? { dateOrder: input.dateOrder } : {}),
        ...(input.decimalStyle !== null ? { decimalStyle: input.decimalStyle } : {}),
      });
    },
    onSuccess: (result, variables) => {
      // Ver a nota em `latest`: só a resposta da análise mais recente é aceite.
      if (analyse.variables !== variables) return;

      setAnalysis(result);
      /*
       * O tipo em vigor passa a ser o que o servidor usou. Se o utilizador escolheu um e o
       * servidor o aceitou, o seletor mostra-o selecionado; se o servidor não conseguiu
       * decidir, fica `null` e o passo do tipo volta a pedir a escolha.
       */
      setKind(result.kind);
      setPhase(nextPhase(result, variables));
    },
  });

  /* ---------------------------------------------------------------------- */
  /* Análise e reanálise                                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * Corre a análise e decide o passo seguinte.
   *
   * O passo seguinte não é fixo: depende do que a análise concluiu. Um ficheiro cujo tipo não
   * pôde ser determinado para no passo do tipo; um com colunas ambíguas para no mapeamento; um
   * plano limpo vai direito à revisão. É esta a divulgação progressiva da §43 — a complexidade
   * só aparece quando existe.
   */
  const run = useCallback(
    (input: AnalysisInput, from: Phase) => {
      latest.current += 1;
      setPhase(from === 'escolher' ? 'analisar' : from);
      analyse.mutate(input);
    },
    [analyse],
  );

  const choose = useCallback(
    (chosen: File, kind: ChosenKind) => {
      setFile(chosen);
      setChosenKind(kind);
      setReport(null);
      setDecisions(new Map());
      setKind(null);
      setDateOrder(null);
      setDecimalStyle(null);

      /*
       * Um ZIP não passa por aqui: o seu fluxo (`BundleImportFlow`) arranca a análise por
       * conta própria assim que monta. Disparar a análise de CSV seria enviar um ZIP para a
       * rota do CSV — que o recusaria com um erro cuja causa o utilizador não conseguiria
       * adivinhar, porque o ficheiro que ele escolheu é válido.
       */
      if (kind === 'zip') return;

      run(
        { file: chosen, kind: null, decisions: [], dateOrder: null, decimalStyle: null },
        'escolher',
      );
    },
    [run],
  );

  /**
   * Reanalisa com o que o utilizador decidiu.
   *
   * Não há forma de adivinhar no cliente o que uma decisão implica: mudar o tipo de registo
   * altera que campos são obrigatórios, o que muda que colunas ficam ambíguas, o que muda a
   * validação e o plano. Recalcular no servidor é mais um pedido, mas é a única forma de o
   * ecrã nunca mostrar um plano construído sobre uma decisão que já não está em vigor.
   */
  const reanalyse = useCallback(
    (patch: {
      kind?: RecordKind | null;
      decisions?: Map<number, string | null>;
      dateOrder?: DateOrder | null;
      decimalStyle?: DecimalStyle | null;
      from: Phase;
    }) => {
      if (!file) return;
      const nextKind = patch.kind !== undefined ? patch.kind : kind;
      const nextDecisions = patch.decisions ?? decisions;
      const nextDateOrder = patch.dateOrder !== undefined ? patch.dateOrder : dateOrder;
      const nextDecimal = patch.decimalStyle !== undefined ? patch.decimalStyle : decimalStyle;

      if (patch.kind !== undefined) setKind(patch.kind);
      if (patch.decisions !== undefined) setDecisions(patch.decisions);
      if (patch.dateOrder !== undefined) setDateOrder(patch.dateOrder);
      if (patch.decimalStyle !== undefined) setDecimalStyle(patch.decimalStyle);

      run(
        {
          file,
          kind: nextKind,
          decisions: [...nextDecisions.entries()],
          dateOrder: nextDateOrder,
          decimalStyle: nextDecimal,
        },
        patch.from,
      );
    },
    [file, kind, decisions, dateOrder, decimalStyle, run],
  );

  /* ---------------------------------------------------------------------- */
  /* Importação (fase 8)                                                     */
  /* ---------------------------------------------------------------------- */

  const apply = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Sem ficheiro analisado.');
      const payload: ColumnDecision[] = [...decisions.entries()].map(([index, field]) => ({
        index,
        field,
      }));
      return applyCsvImport(file, {
        ...(kind !== null ? { kind } : {}),
        ...(payload.length > 0 ? { decisions: payload } : {}),
        ...(dateOrder !== null ? { dateOrder } : {}),
        ...(decimalStyle !== null ? { decimalStyle } : {}),
        // O identificador da análise que o utilizador aprovou. Se os bytes entretanto
        // mudarem, este valor deixa de corresponder e o servidor recusa com 409 em vez de
        // escrever um plano que o utilizador não viu.
        ...(analysis !== null ? { identity: analysis.identity.key } : {}),
      });
    },
    onSuccess: (result) => {
      setReport(result);
      setPhase('relatorio');
      toast.show(result.headline, { variant: result.applied ? 'ok' : 'info' });
    },
  });

  const restart = useCallback(() => {
    setFile(null);
    setChosenKind(null);
    setAnalysis(null);
    setReport(null);
    setDecisions(new Map());
    setKind(null);
    setDateOrder(null);
    setDecimalStyle(null);
    setPhase('escolher');
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Apresentação                                                            */
  /* ---------------------------------------------------------------------- */

  const analysing = phase === 'analisar';
  const showSteps = phase !== 'escolher' && phase !== 'analisar' && analysis !== null;

  /** O ficheiro escolhido é um bundle: o fluxo é outro, mais curto e sem mapeamento. */
  const isBundle = chosenKind === 'zip' && file !== null;

  return (
    <div className="z-page">
      <PageHeader
        title="Importar de um ficheiro"
        subtitle="Traz dados de outra aplicação a partir de um CSV, ou repõe uma cópia de segurança do Zemlo. Nada é escrito até tu confirmares."
        back={{ to: '/export', label: 'Os teus dados' }}
        actions={
          showSteps || isBundle ? (
            <Button variant="ghost" onClick={restart}>
              Começar de novo
            </Button>
          ) : null
        }
      />

      {/*
       * A barra de passos é do CSV e não aparece no fluxo do bundle. Os seus cinco passos
       * (tipo → colunas → revisão → relatório) descrevem um percurso que um bundle não faz:
       * ele já traz o tipo e as colunas resolvidos. Mostrá-la com passos a saltar seria
       * dizer ao utilizador que faltou fazer algo que nunca lhe foi pedido.
       */}
      {showSteps ? <Steps current={stepIndex(phase)} /> : null}

      {isBundle ? (
        <BundleImportFlow file={file} onRestart={restart} />
      ) : phase === 'escolher' || analysing ? (
        <Dropzone file={file} busy={analysing} onChoose={choose} />
      ) : null}

      {!isBundle && analyse.isError ? (
        <InlineError
          message={errorMessage(analyse.error)}
          requestId={errorRequestId(analyse.error)}
          onRetry={() => {
            if (!file) return;
            reanalyse({ from: analysis === null ? 'escolher' : 'mapear' });
          }}
        />
      ) : null}

      {analysis !== null && showSteps ? (
        <>
          <DetectionStep detection={analysis.detection} />

          {/* Fase 4 (§10.5): o tipo de registo. Só aparece quando o servidor não decidiu. */}
          {(phase === 'tipo' || analysis.kind === null) && !analysing ? (
            <KindStep
              inference={analysis.inference}
              options={recordKindOptions()}
              selected={kind}
              busy={analyse.isPending}
              onChoose={(chosen) => reanalyse({ kind: chosen, from: 'tipo' })}
            />
          ) : null}

          {/* Fase 4 (§10.4): as colunas. Sempre visível quando há algo a confirmar ou a
              corrigir — e recolhida quando o mapeamento está resolvido sem intervenção. */}
          {phase !== 'tipo' && !analysing ? (
            <MappingStep
              mapping={analysis.mapping}
              decided={decisions}
              busy={analyse.isPending}
              dateOrder={dateOrder}
              decimalStyle={decimalStyle}
              kind={analysis.kind}
              onDecide={(index, field) => {
                const next = new Map(decisions);
                next.set(index, field);
                reanalyse({ decisions: next, from: 'mapear' });
              }}
              onConvention={(patch) => reanalyse({ ...patch, from: 'mapear' })}
              onContinue={() => setPhase('rever')}
              readOnly={phase === 'rever' || phase === 'relatorio'}
            />
          ) : null}

          {/* Fases 5–7 (§10.2): pré-visualização normalizada, problemas e duplicados. */}
          {(phase === 'rever' || phase === 'relatorio') && !analysing ? (
            <PreviewStep
              preview={analysis.preview}
              skipped={analysis.skipped}
              valueIssues={analysis.valueIssues}
              emptyReason={analysis.emptyReason}
              kind={analysis.kind}
              detection={analysis.detection}
            />
          ) : null}

          {(phase === 'rever' || phase === 'relatorio') && !analysing ? (
            <PlanStep
              plan={analysis.plan}
              savedMap={analysis.savedMap}
              busy={apply.isPending}
              applied={report !== null}
              onApply={() => apply.mutate()}
              onBack={() => setPhase('mapear')}
            />
          ) : null}
        </>
      ) : null}

      {!isBundle && apply.isError && report === null ? (
        <InlineError
          message={errorMessage(apply.error)}
          requestId={errorRequestId(apply.error)}
          onRetry={() => apply.mutate()}
        />
      ) : null}

      {/* Fase 9: o relatório. */}
      {!isBundle && report !== null ? <ReportStep report={report} onRestart={restart} /> : null}

      {!isBundle && phase === 'escolher' && !analysing ? <HowItWorks /> : null}
    </div>
  );
}

/**
 * O passo a mostrar depois de uma análise.
 *
 * A ordem reflete a dependência real entre as decisões: não se mapeiam colunas sem se saber
 * que tipo de registo se está a construir (o tipo determina os campos obrigatórios), e não se
 * revê um plano antes de as colunas estarem resolvidas.
 */
function nextPhase(result: CsvPreviewResponse, input: AnalysisInput): Phase {
  // Sem tipo de registo não há campos obrigatórios, e sem eles o mapeamento não tem critério.
  if (result.kind === null) return 'tipo';

  /*
   * `readyWithoutInput` é a autoridade, e é por isso que esta verificação vem primeiro e
   * sozinha: é o servidor que sabe se alguma coisa impede a construção de registos — uma
   * coluna ambígua (§10.4) **ou** um valor com mais do que uma leitura (`1,589`, `03/04/2026`).
   *
   * O ecrã não repete essa decisão com um segundo critério. Antes desta correção o cliente
   * verificava só `ambiguousColumns.length > 0`, pelo que uma ambiguidade de **valor** —
   * que não aparece em `ambiguousColumns`, porque o mapeamento está certo — avançava direto
   * para uma revisão vazia onde o botão de importar estava desativado sem explicação.
   */
  if (!result.mapping.readyWithoutInput) return 'mapear';

  /*
   * Uma convenção por confirmar (dia/mês, vírgula decimal) mantém o ecrã no mapeamento — é lá
   * que ela é pedida, à frente da coluna que a originou. `ambiguousColumns` vazio mas o
   * utilizador vindo de uma decisão de convenção significa que veio de `mapear`; nesse caso
   * respeita-se a intenção e volta-se à revisão, porque a convenção já foi aplicada.
   */
  if (input.decisions.length === 0 && result.mapping.ambiguousColumns.length > 0) return 'mapear';

  if (input.kind !== null && input.kind !== result.kind) {
    /*
     * O utilizador escolheu um tipo e o servidor usou-o — mas a escolha veio do passo do
     * tipo, pelo que o mapeamento ainda não foi visto. Avança-se, mostrando-o na revisão,
     * onde as colunas continuam corrigíveis.
     */
    return 'rever';
  }

  return 'rever';
}

/** O índice visual do passo, para a barra de progresso. */
function stepIndex(phase: Phase): number {
  switch (phase) {
    case 'escolher':
    case 'analisar':
      return 0;
    case 'tipo':
      return 1;
    case 'mapear':
      return 2;
    case 'rever':
      return 3;
    case 'relatorio':
      return 4;
    default:
      return 0;
  }
}

/**
 * A explicação do que vai acontecer, mostrada apenas no primeiro passo.
 *
 * Existe porque a primeira importação é a mais assustadora e a que mais precisa de ser
 * explicada (§11.5), e desaparece assim que o utilizador tem um ficheiro em mãos: a partir
 * daí, mostrar o que se percebeu do ficheiro é mais útil do que uma explicação geral.
 */
function HowItWorks() {
  return (
    <Card soft>
      <div className="z-card__header">
        <div>
          <div className="z-card__title">Como funciona</div>
          <div className="z-card__subtitle">Nada é escrito sem tu confirmares</div>
        </div>
      </div>

      <ol className="z-steps-list">
        <li>
          <span>
            <strong>Escolhe o ficheiro.</strong> Um CSV de outra aplicação, ou uma cópia de
            segurança do Zemlo. Não precisa de ter um formato específico.
          </span>
        </li>
        <li>
          <span>
            <strong>Percebo o que lá está.</strong> Deteto a codificação, o separador e o
            cabeçalho, e comparo cada coluna com os campos que o Zemlo conhece. Num ZIP, leio o
            índice do ficheiro e verifico a integridade de tudo o que ele declara.
          </span>
        </li>
        <li>
          <span>
            <strong>Tu confirmas.</strong> Mostro o que reconheci, o que ficou ambíguo e como
            ficam as primeiras linhas já convertidas. Só depois disto é que algo é escrito.
          </span>
        </li>
        <li>
          <span>
            <strong>Guardo o mapa.</strong> Da próxima vez que importares deste fornecedor, o
            mesmo formato é um clique.
          </span>
        </li>
      </ol>

      <Disclosure label="O que acontece aos registos que já tenho">
        <p className="z-small z-muted">
          Nada é substituído em silêncio. Um registo que já exista e que seja igual ao do
          ficheiro é ignorado. Um registo que já exista e a que falte um campo que o ficheiro
          traz é <strong>completado</strong> nesse campo. Se o ficheiro disser uma coisa
          diferente da que tens, o registo é marcado como <Chip tone="warn">em conflito</Chip> e
          nada é alterado sem tu decidires.
        </p>
        <p className="z-xs z-muted">
          O comportamento por omissão é "preencher apenas o que está vazio". É assimétrico de
          propósito: no pior caso aparecem dados a mais que podes apagar, em vez de perderes
          histórico que não podes recuperar.
        </p>
      </Disclosure>

      <Disclosure label="Que ficheiros são aceites">
        <ul className="z-stack z-stack--tight z-small z-muted">
          <li>
            <strong>CSV</strong> com separador <span className="z-mono">;</span> (Excel em
            português), <span className="z-mono">,</span> ou tabulação.
          </li>
          <li>
            <strong>ZIP</strong> de uma cópia de segurança do Zemlo (Definições → os teus
            dados → transferir cópia de segurança). Traz os documentos e as relações, e o
            Zemlo verifica a integridade antes de escrever.
          </li>
          <li>
            <strong>Codificação</strong> UTF-8, UTF-8 com BOM ou CP1252 (o formato do Excel
            antigo em Windows). Se o ficheiro tiver acentos corrompidos, é aqui que se resolve.
          </li>
          <li>
            <strong>Datas</strong> em qualquer ordem — se forem ambíguas, pergunto-te.{' '}
            <strong>Valores</strong> com vírgula ou ponto decimal, detetados pelo padrão da
            coluna.
          </li>
          <li>
            <strong>Folhas de cálculo (XLSX)</strong> ainda não são aceites. Guarda como CSV: no
            Excel, <span className="z-mono">Ficheiro → Guardar como → CSV UTF-8</span>.
          </li>
        </ul>
      </Disclosure>
    </Card>
  );
}
