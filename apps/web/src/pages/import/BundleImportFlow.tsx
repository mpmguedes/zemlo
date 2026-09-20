import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, InlineError, LoadingBlock } from '../../ui/primitives';
import { useToast } from '../../ui/Toaster';
import { errorMessage, errorRequestId } from '../../api/errors';
import { applyBundleImport, previewBundleImport } from '../../api/queries';
import type { BundleApplyResponse, BundlePreviewResponse } from '../../api/queries';
import { BundlePlanStep } from './BundlePlanStep';
import { BundleReportStep } from './BundleReportStep';

/**
 * O ciclo de importação de um bundle Zemlo (Camada 1, §3.1).
 *
 * ## Porque é que este fluxo é mais curto do que o do CSV, e não uma versão reduzida dele
 *
 * As duas camadas partilham a mesma proibição — nada é escrito antes de o utilizador
 * confirmar — e a mesma separação em dois pedidos. O que muda é o que **há para descobrir**:
 *
 *  - um CSV é um ficheiro que não conhecemos, e por isso o ecrã tem de detetar a codificação,
 *    mapear colunas e perguntar as convenções ambíguas. O trabalho do utilizador é ensinar o
 *    Zemlo a ler o ficheiro;
 *  - um bundle conhece-se a si mesmo: tem um `manifest` que declara os ficheiros, os
 *    `sha256` e o âmbito. O trabalho do utilizador é **rever** — e o Zemlo já fez o resto.
 *
 * Acrescentar passos de deteção e mapeamento aqui encheria o ecrã com passos vazios, porque
 * não há nada a detetar nem a mapear. O fluxo curto não é menos rigoroso: é a mesma
 * disciplina aplicada a um artefacto que já traz a sua própria estrutura.
 *
 * ## Os dois pedidos
 *
 *  1. `preview` — envia os bytes e recebe o plano. **Não escreve nada.**
 *  2. `apply` — reenvia os **mesmos bytes** e o plano aprovado. Escreve.
 *
 * ## Porque é que o ficheiro é reenviado no `apply`
 *
 * O `apply` **reanalisa os bytes** em vez de confiar no plano que recebe. É essa a defesa,
 * do lado do servidor, contra "o plano não é deste ficheiro". Reenviar o mesmo `File` é, por
 * isso, a única forma de a identidade dos bytes coincidir entre a análise e a escrita — e o
 * `bundleId` viaja no plano para que o servidor possa **recusar** um plano que já não
 * corresponda ao que recebeu, em vez de escrever outra coisa.
 */
export function BundleImportFlow({
  file,
  onRestart,
}: {
  file: File;
  onRestart: () => void;
}) {
  const toast = useToast();

  const [preview, setPreview] = useState<BundlePreviewResponse | null>(null);
  const [report, setReport] = useState<BundleApplyResponse | null>(null);

  /*
   * A análise arranca no primeiro render da fase, e não num efeito.
   *
   * O `useState` com o inicializador do `useMutation` abaixo não corre sozinho: as mutações
   * são imperativas de propósito (é o que permite ao React Query não repetir um pedido que
   * escreve). Como este fluxo não tem nada a decidir antes de analisar — ao contrário do
   * CSV, que reanalisa a cada decisão —, disparar uma vez é o comportamento correto, e o
   * `useEffect` com guarda é a forma de o garantir sem repetir num `StrictMode`.
   */
  const analyse = useMutation({
    mutationFn: () => previewBundleImport(file),
    onSuccess: (result) => setPreview(result),
  });

  /**
   * Dispara a análise uma única vez, quando o componente monta.
   *
   * A guarda vive numa `ref` e não no estado: um segundo render (o `StrictMode` monta duas
   * vezes em desenvolvimento) não pode reenviar o ficheiro. Sem ela, o mesmo ZIP seria
   * analisado duas vezes — inofensivo, porque o `preview` não escreve, mas um pedido a mais
   * por cada ficheiro escolhido.
   */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    analyse.mutate();
  }, [analyse]);

  const apply = useMutation({
    mutationFn: () => {
      if (preview === null) throw new Error('Sem análise para aplicar.');
      // O corpo do preview **é** o plano que o `apply` aceita: reenviá-lo tal como veio é o
      // que garante que o que o utilizador aprovou é o que chega ao servidor.
      return applyBundleImport(file, preview);
    },
    onSuccess: (result) => {
      setReport(result);
      toast.show(result.headline, { variant: result.applied ? 'ok' : 'info' });
    },
  });

  const restart = useCallback(() => {
    setPreview(null);
    setReport(null);
    onRestart();
  }, [onRestart]);

  /* ---------------------------------------------------------------------- */
  /* Apresentação                                                            */
  /* ---------------------------------------------------------------------- */

  if (analyse.isError && preview === null) {
    return (
      <InlineError
        message={errorMessage(analyse.error)}
        requestId={errorRequestId(analyse.error)}
        onRetry={() => analyse.mutate()}
      />
    );
  }

  if (preview === null) {
    return <LoadingBlock label="A ler o ficheiro…" />;
  }

  return (
    <>
      <BundlePlanStep
        preview={preview}
        busy={apply.isPending}
        applied={report !== null}
        onApply={() => apply.mutate()}
        onRestart={restart}
      />

      {apply.isError && report === null ? (
        <InlineError
          message={errorMessage(apply.error)}
          requestId={errorRequestId(apply.error)}
          onRetry={() => apply.mutate()}
        />
      ) : null}

      {report !== null ? <BundleReportStep report={report} onRestart={restart} /> : null}

      {report !== null ? (
        <div className="z-row" style={{ gap: 'var(--z-space-2)' }}>
          <Button variant="ghost" onClick={restart}>
            Importar outro ficheiro
          </Button>
        </div>
      ) : null}
    </>
  );
}
