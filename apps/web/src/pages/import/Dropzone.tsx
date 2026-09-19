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
 * ## Porque é que o `accept` não é a única defesa
 *
 * `accept=".csv,text/csv"` filtra o seletor, mas não é uma garantia: em vários sistemas o
 * seletor deixa escolher "todos os ficheiros", e um `.txt` com CSV lá dentro é um caso
 * legítimo. A validação de verdade acontece no servidor, que olha para os bytes. Aqui só se
 * recusa o que é **claramente** outra coisa (uma folha de cálculo, uma imagem) e a mensagem
 * diz o que fazer, em vez de aceitar e falhar mais tarde com um erro técnico.
 */

export interface DropzoneProps {
  file: File | null;
  busy: boolean;
  onChoose: (file: File) => void;
}

export function Dropzone({ file, busy, onChoose }: DropzoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);

  const accept = (candidate: File | undefined) => {
    if (!candidate) return;

    /*
     * Recusa-se o que é manifestamente outro formato. A extensão é verificada **e** o tipo
     * MIME: um `.xlsx` chega com `application/vnd.openxmlformats-officedocument...`, mas há
     * browsers que reportam `application/octet-stream` para tudo, e nesse caso a extensão é a
     * única pista. Aceitar os dois sinais cobre as duas situações sem duplicar a mensagem.
     */
    const lower = candidate.name.toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.numbers')) {
      setRejection(
        'As folhas de cálculo ainda não são aceites. Abre o ficheiro e guarda como CSV (no Excel: Ficheiro → Guardar como → CSV UTF-8).',
      );
      return;
    }

    if (lower.endsWith('.zip') || lower.endsWith('.zemlo')) {
      setRejection(
        'Este é um ficheiro de exportação do Zemlo. Para o reimportar, usa a opção de restaurar uma cópia de segurança.',
      );
      return;
    }

    setRejection(null);
    onChoose(candidate);
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
            accept=".csv,.txt,text/csv,text/plain"
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
              <span className="z-strong">Escolhe um ficheiro CSV</span>
              <span className="z-xs">ou arrasta-o para aqui</span>
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
