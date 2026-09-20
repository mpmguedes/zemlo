import { useRef, useState } from 'react';
import { Button, Card } from '../../ui/primitives';
import { formatBytes } from '../../lib/format';

/**
 * A escolha do ficheiro (fase 1 da §10.2).
 *
 * ## Porque é que há um `<input type="file">` e um `z-dropzone`
 *
 * O `input` real fica invisível por dentro do rótulo: é a única forma de o toque em telemóvel
 * abrir o seletor nativo de ficheiros (que inclui iCloud, Drive e a câmara) sem JavaScript a
 * fingir um botão. O `z-dropzone` é a superfície visível e o alvo do arrasto no ambiente de
 * trabalho — as duas funcionalidades, um só controlo.
 *
 * ## Dois formatos, um só ponto de entrada
 *
 * Este ecrã aceita **CSV** e **ZIP** — as duas camadas da §3.2 — e encaminha cada um para o
 * seu pipeline. A alternativa seria um ecrã por formato, mas isso obrigaria o utilizador a
 * saber qual tem em mãos antes de o escolher: uma distinção nossa, apresentada como um
 * problema dele.
 *
 * A escolha entre os dois não é adivinhada pela extensão sozinha: a extensão é um sinal, e
 * o conteúdo é a verdade. O **tipo MIME e a extensão** são usados aqui para encaminhar, e o
 * servidor decide em definitivo ao olhar para os bytes — um `.zip` renomeado para `.csv`
 * chega ao pipeline do CSV e é lá recusado, e não é este ficheiro que tem de o impedir.
 *
 * ## Porque é que o `accept` não é a única defesa
 *
 * `accept=".csv,.txt,.zip,…"` filtra o seletor, mas não é uma garantia: em vários sistemas o
 * seletor deixa escolher "todos os ficheiros", e um `.txt` com CSV lá dentro é um caso
 * legítimo. A validação de verdade acontece no servidor, que olha para os bytes. Aqui só se
 * recusa o que é **claramente** outra coisa (uma folha de cálculo, uma imagem) e a mensagem
 * diz o que fazer, em vez de aceitar e falhar mais tarde com um erro técnico.
 */

/**
 * O tipo de ficheiro que o utilizador escolheu.
 *
 *  - `csv`   — texto para a Camada 2, com mapeamento de colunas e convenções a confirmar;
 *  - `zip`   — um bundle Zemlo para a Camada 1, já interpretado e com integridade a verificar;
 *  - `outro` — manifestamente outra coisa; a Dropzone recusa e explica porquê.
 */
export type ChosenKind = 'csv' | 'zip';

export interface DropzoneProps {
  file: File | null;
  busy: boolean;
  onChoose: (file: File, kind: ChosenKind) => void;
}

/**
 * Classifica um ficheiro escolhido, sem o abrir.
 *
 * ## Porque é que a extensão e o MIME são ambos consultados
 *
 * Nenhum dos dois é fiável sozinho. O Windows reporta `application/x-zip-compressed` para
 * um ZIP e `text/plain` para muitos CSV; alguns browsers reportam
 * `application/octet-stream` para tudo. Exigir os dois concordarem recusaria ficheiros
 * legítimos; confiar só num deles deixaria passar os outros. Aceita-se qualquer um dos
 * sinais como indicação de encaminhamento — e a decisão final é sempre do servidor, que lê
 * os bytes.
 *
 * ## Porque é que `application/zip` no CSV não é aceite
 *
 * Um ZIP anda em sentido contrário: se o MIME diz ZIP e a extensão diz `.csv`, o ficheiro é
 * ambíguo e vale mais recusá-lo aqui do que enviá-lo para o pipeline errado. A regra é:
 * **qualquer sinal de ZIP manda para a Camada 1**, porque é o pipeline que verifica a
 * integridade e recusa o que não for um bundle — o inverso não é verdade, e o CSV não
 * consegue detetar que recebeu um ZIP.
 */
export function classifyFile(candidate: File): ChosenKind | 'outro' {
  const lower = candidate.name.toLowerCase();
  const mime = candidate.type.toLowerCase();

  // Folhas de cálculo: nem CSV nem bundle. A recusa é específica e diz o que fazer.
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.numbers')) {
    return 'outro';
  }

  const looksZip =
    lower.endsWith('.zip') ||
    lower.endsWith('.zemlo') ||
    mime === 'application/zip' ||
    mime === 'application/x-zip-compressed';

  if (looksZip) return 'zip';

  return 'csv';
}

export function Dropzone({ file, busy, onChoose }: DropzoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);

  const accept = (candidate: File | undefined) => {
    if (!candidate) return;

    const kind = classifyFile(candidate);

    if (kind === 'outro') {
      setRejection(
        'As folhas de cálculo ainda não são aceites. Abre o ficheiro e guarda como CSV (no Excel: Ficheiro → Guardar como → CSV UTF-8).',
      );
      return;
    }

    setRejection(null);
    onChoose(candidate, kind);
  };

  return (
    <Card>
      <div className="z-stack">
        <label
          className="z-dropzone"
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            accept(event.dataTransfer.files[0]);
          }}
          style={
            dragging
              ? { borderColor: 'var(--z-accent)', background: 'var(--z-accent-soft)' }
              : undefined
          }
        >
          <input
            ref={input}
            type="file"
            // `.zip` antes de `.csv`: a ordem não tem significado para o `accept`, mas
            // deixar os dois explícitos é o que faz o seletor nativo mostrar ambos.
            accept=".csv,.txt,.zip,.zemlo,text/csv,text/plain,application/zip,application/x-zip-compressed"
            onChange={(event) => {
              accept(event.target.files?.[0]);
              // Limpar o valor permite escolher o mesmo ficheiro outra vez depois de um erro.
              event.target.value = '';
            }}
            // Escondido visualmente mas presente na árvore de acessibilidade: um
            // `display: none` retirá-lo-ia da navegação por teclado.
            style={{
              position: 'absolute',
              width: 1,
              height: 1,
              padding: 0,
              margin: -1,
              overflow: 'hidden',
              clip: 'rect(0 0 0 0)',
              whiteSpace: 'nowrap',
              border: 0,
            }}
          />

          <span aria-hidden="true" style={{ fontSize: '2rem' }}>
            {busy ? '⏳' : '📄'}
          </span>

          {file ? (
            <>
              <span className="z-strong">{file.name}</span>
              <span className="z-xs z-muted">
                {formatBytes(file.size)}
                {busy ? ' · a analisar…' : ''}
              </span>
            </>
          ) : (
            <>
              <span className="z-strong">Escolhe um ficheiro</span>
              <span className="z-xs">CSV de outra aplicação, ou um ZIP do Zemlo</span>
            </>
          )}

          <span style={{ pointerEvents: 'none', marginTop: 'var(--z-space-2)' }}>
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              // O clique no rótulo já abre o seletor; o botão existe para dar uma affordance
              // óbvia a quem não reconhece a zona como clicável.
              onClick={(event) => {
                event.preventDefault();
                input.current?.click();
              }}
            >
              {file ? 'Escolher outro' : 'Escolher ficheiro'}
            </Button>
          </span>
        </label>

        {rejection ? (
          <p className="z-field__error" role="alert">
            {rejection}
          </p>
        ) : null}

        <p className="z-xs z-muted">
          O ficheiro é enviado para análise e os registos só são escritos depois de tu
          confirmares. Nada do que está no ficheiro é guardado antes disso.
        </p>
      </div>
    </Card>
  );
}
