import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { normalizePlate } from '@zemlo/shared';
import { useSession } from '../../app/SessionContext';
import { useCreateVehicle, useProfile, useRecordOdometer, useVehicles } from '../../api/hooks';
import { Logo } from '../../components/Logo';
import { Banner, Button, Metric } from '../../ui/primitives';
import { ApiError } from '../../api/client';
import { useForm } from '../../hooks/useForm';
import { Field } from '../../ui/form';

/**
 * Onboarding (§5).
 *
 * Três passos e nenhum mais: **conta → primeiro veículo → está feito.** O passo do veículo
 * pede apenas a matrícula, porque é o único campo que o produto realmente precisa para
 * começar a funcionar, e é o que o utilizador sabe de cor. Ano, versão, VIN, cor, potência —
 * tudo isso é enriquecimento progressivo (§6) e vive na ficha do veículo, onde pode ser
 * preenchido quando (e se) fizer sentido.
 *
 * A quilometragem aparece como campo **opcional** e explicado: é o que permite calcular o
 * custo por km e prever quando a próxima revisão chega. Sem ela, o Zemlo funciona na mesma —
 * só responde a menos perguntas. Dizer isto é o que separa um campo opcional de um campo que
 * o utilizador sente como obrigatório.
 */
export type OnboardingStep = 'account' | 'vehicle' | 'done';

export function OnboardingPage({ step }: { step: OnboardingStep }) {
  return (
    <div className="z-auth">
      <div className="z-auth__card" style={{ maxWidth: 480 }}>
        <div className="z-auth__head">
          <Logo variant="lockup" size={34} />
        </div>
        <Steps current={step} />
        {step === 'account' && <AccountStep />}
        {step === 'vehicle' && <VehicleStep />}
        {step === 'done' && <DoneStep />}
      </div>
    </div>
  );
}

/** Indicador de progresso. Dois passos com ação, um de confirmação. */
function Steps({ current }: { current: OnboardingStep }) {
  const index = current === 'account' ? 0 : current === 'vehicle' ? 1 : 2;
  return (
    <div className="z-steps" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={index + 1} aria-label={`Passo ${index + 1} de 3`}>
      {[0, 1, 2].map((position) => (
        <span
          key={position}
          className={[
            'z-steps__dot',
            position < index ? 'z-steps__dot--done' : '',
            position === index ? 'z-steps__dot--current' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Passo 1 — conta                                                             */
/* -------------------------------------------------------------------------- */

function AccountStep() {
  const { profile } = useSession();
  const navigate = useNavigate();

  return (
    <>
      <div className="z-auth__head">
        <h1 className="z-auth__title">Conta criada</h1>
        <p className="z-auth__subtitle">
          {profile?.email ? `Sessão iniciada como ${profile.email}.` : 'A tua conta está pronta.'}
        </p>
      </div>
      <Banner tone="ok" title="Passo 1 de 3 concluído">
        Não pedimos cartão, telefone nem confirmação por email. A conta existe e é tua.
      </Banner>
      <Button variant="primary" block onClick={() => navigate('/onboarding/veiculo')}>
        Continuar
      </Button>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Passo 2 — primeiro veículo                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Passo do veículo.
 *
 * A normalização da matrícula é feita com `normalizePlate` do domínio partilhado — a mesma
 * função que a API usa. Escrever uma segunda normalização aqui produziria matrículas
 * diferentes para o mesmo carro conforme o ecrã onde foram escritas.
 *
 * A pré-visualização da forma normalizada (`42-38-EL`) confirma ao utilizador que o Zemlo
 * percebeu o que ele escreveu, **antes** de gravar. Num campo onde se aceitam oito formatos
 * diferentes, esse retorno é o que evita uma matrícula mal escrita na base de dados.
 */
function VehicleStep() {
  const navigate = useNavigate();
  const { refreshProfile } = useSession();
  const createVehicle = useCreateVehicle();
  const odometer = useRecordOdometer(undefined);
  const form = useForm({ plate: '', odometerKm: '' });
  const [error, setError] = useState<unknown>(null);

  const normalized = normalizePlate(form.values.plate);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    form.clearErrors();
    form.setSubmitting(true);
    try {
      const vehicle = await createVehicle.mutateAsync({ plate: form.values.plate });
      // A quilometragem é registada pelo endpoint sem veículo (§5): o utilizador acabou de
      // criar o primeiro carro e não faz ideia de que existe um identificador. O Zemlo
      // resolve-o sozinho.
      const kilometres = Number(form.values.odometerKm.replace(/\s/g, '').replace(',', '.'));
      if (Number.isFinite(kilometres) && kilometres > 0) {
        await odometer.submit({ odometerKm: Math.round(kilometres) });
      }
      await refreshProfile();
      void vehicle;
      navigate('/onboarding/pronto', { replace: true });
    } catch (caught) {
      setError(caught);
      form.setServerError(caught);
    } finally {
      form.setSubmitting(false);
    }
  }

  return (
    <>
      <div className="z-auth__head">
        <h1 className="z-auth__title">O teu primeiro veículo</h1>
        <p className="z-auth__subtitle">Só a matrícula é obrigatória. O resto completa-se quando quiseres.</p>
      </div>

      <form className="z-stack" onSubmit={onSubmit} noValidate>
        <Field
          label="Matrícula"
          required
          hint={
            normalized.value
              ? normalized.valid
                ? `Vamos guardar como ${normalized.display}${normalized.format === 'unknown' ? ' — formato não português, aceita-se na mesma' : ''}.`
                : 'Escreve a matrícula como aparece no documento.'
              : 'Podes escrever com ou sem hífenes, em maiúsculas ou minúsculas.'
          }
          error={form.fieldError('plate')}
        >
          {({ inputId, describedBy }) => (
            <input
              id={inputId}
              className="z-input"
              // `autoCapitalize` e `autoComplete` desligados: a matrícula é um código, não
              // uma palavra, e a correção automática do telemóvel só atrapalha.
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              required
              placeholder="42-38-EL"
              value={form.values.plate}
              onChange={(event) => form.setValue('plate', event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={form.fieldError('plate') ? true : undefined}
            />
          )}
        </Field>

        <Field
          label="Quilometragem atual"
          hint="Opcional, mas é o que permite calcular o custo por km e prever a próxima revisão."
          error={form.fieldError('odometerKm')}
        >
          {({ inputId, describedBy }) => (
            <div className="z-input-group">
              <input
                id={inputId}
                className="z-input"
                inputMode="numeric"
                autoComplete="off"
                placeholder="43 560"
                value={form.values.odometerKm}
                onChange={(event) => form.setValue('odometerKm', event.target.value)}
                aria-describedby={describedBy}
              />
              <span className="z-input-group__suffix">km</span>
            </div>
          )}
        </Field>

        {error ? (
          <div className="z-inline-error" role="alert">
            <span>{error instanceof ApiError ? error.message : 'Não foi possível guardar o veículo.'}</span>
            {error instanceof ApiError && error.requestId ? (
              <span className="z-request-id">Referência para apoio: {error.requestId}</span>
            ) : null}
          </div>
        ) : null}

        <Button type="submit" variant="primary" block loading={form.isSubmitting}>
          Continuar
        </Button>
        <Button
          variant="ghost"
          block
          type="button"
          onClick={() => navigate('/onboarding/pronto')}
          disabled={form.isSubmitting}
        >
          Adicionar o veículo mais tarde
        </Button>
      </form>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Passo 3 — está feito                                                        */
/* -------------------------------------------------------------------------- */

function DoneStep() {
  const navigate = useNavigate();
  const { data: profile } = useProfile();
  const { data: vehicles } = useVehicles();

  // Quem chega aqui por link direto sem ter criado um veículo é reencaminhado: "está feito"
  // não é verdade para essa pessoa, e mostrar-lhe uma confirmação falsa seria pior do que
  // pedir-lhe o passo que falta.
  useEffect(() => {
    if (vehicles && vehicles.items.length === 0) navigate('/onboarding/veiculo', { replace: true });
  }, [vehicles, navigate]);

  const vehicle = vehicles?.items[0];

  return (
    <>
      <div className="z-auth__head">
        <span className="z-empty__icon" aria-hidden="true">
          ✅
        </span>
        <h1 className="z-auth__title">Está feito.</h1>
        <p className="z-auth__subtitle">
          {vehicle
            ? `${vehicle.plateDisplay} está no Zemlo. A partir daqui registas custos, manutenção e prazos — e o painel trata de te avisar.`
            : 'A tua conta está pronta.'}
        </p>
      </div>

      <div className="z-grid z-grid--2">
        <Metric label="Veículos" value={profile?.counts.vehicles ?? 1} small />
        <Metric label="Registos este ano" value={profile?.counts.expenses ?? 0} small />
      </div>

      <Banner tone="info" title="O que fazer a seguir">
        Os três primeiros passos que fazem o Zemlo responder a perguntas a sério: registar um
        abastecimento ou carregamento (para o custo por km), guardar o seguro e a inspeção
        (para os avisos) e marcar a próxima manutenção (para o lembrete).
      </Banner>

      <Button variant="primary" block onClick={() => navigate('/', { replace: true })}>
        Ir para o painel
      </Button>

      <p className="z-auth__footer">
        Precisas de outro veículo mais tarde? <Link to="/vehicles/new">Adicionar veículo</Link>
      </p>
    </>
  );
}
