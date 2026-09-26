import { useState } from 'react';
import type { RecordKind } from '@zemlo/shared';
import { Sheet } from '../ui/Sheet';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/primitives';
import { recordIconName } from '../lib/registerMenu';
import { ESCOLHER_OUTRO_TIPO, NOVO_REGISTO, novoRegistoKinds, repeatLabel } from '../lib/postSave';

/**
 * Seletor de novo registo (decisão §53).
 *
 * Existe para responder a uma fricção concreta: quem acabou de registar um abastecimento
 * costuma querer registar outro tipo de coisa logo a seguir — ou repetir o mesmo. Sem isto, o
 * «Novo registo» do aviso obrigaria a voltar ao início do fluxo (painel → botão → escolher),
 * que é o caminho que a §53 manda evitar.
 *
 * ## Porque é que são dois passos e não um
 *
 * A §53 pede, ao tocar em «Novo registo», **duas** escolhas: «Repetir [tipo]» e «Escolher outro
 * tipo». O primeiro passo é portanto a decisão entre repetir e mudar; só «Escolher outro tipo»
 * abre a lista. Mostrar logo a lista pouparia um toque mas perderia a repetição — que é o caso
 * mais frequente — e é por isso que a repetição é a ação **primária** e a mudança é secundária.
 *
 * ## Quando não há tipo anterior
 *
 * Se o registo não veio de um tipo conhecido (não há «anterior»), não há repetição a oferecer:
 * a folha abre diretamente na lista, em vez de mostrar um botão «Repetir» sem sentido.
 */
export interface QuickLogChooserProps {
  /** Tipo acabado de gravar, para oferecer a repetição. `null` quando não há. */
  previousKind: RecordKind | null;
  /** Escolha do utilizador: o tipo a abrir na folha de registo. */
  onSelect: (kind: RecordKind) => void;
  onClose: () => void;
}

export function QuickLogChooser({ previousKind, onSelect, onClose }: QuickLogChooserProps) {
  // Sem tipo anterior não há primeiro passo: a lista é o primeiro (e único) ecrã.
  const [mostrarTipos, setMostrarTipos] = useState(previousKind === null);

  return (
    <Sheet open onClose={onClose} title={NOVO_REGISTO}>
      {mostrarTipos ? (
        <div className="z-quick-actions">
          {novoRegistoKinds().map(({ kind, label }) => (
            <button key={kind} type="button" className="z-quick-action" onClick={() => onSelect(kind)}>
              {/*
                Ícone local, o mesmo que o menu «Registar» usa (`recordIconName`) — a §53 e a §46
                perguntam a mesma coisa («que registo?») e têm de ter a mesma cara. Antes vinha
                aqui o emoji do contrato: era o mesmo tipo com dois desenhos diferentes no mesmo
                produto, e o emoji ignorava o tema e o `stroke-width` da família.
              */}
              <span className="z-quick-action__icon" aria-hidden="true">
                <Icon name={recordIconName(kind)} />
              </span>
              {label}
            </button>
          ))}
        </div>
      ) : previousKind ? (
        <div className="z-stack">
          <Button variant="primary" block onClick={() => onSelect(previousKind)}>
            {repeatLabel(previousKind)}
          </Button>
          <Button variant="secondary" block onClick={() => setMostrarTipos(true)}>
            {ESCOLHER_OUTRO_TIPO}
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}
