import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useUpdateProfile } from '../../api/hooks';
import { useSession } from '../../app/SessionContext';
import { errorMessage, errorRequestId } from '../../api/errors';
import { ApiError } from '../../api/client';
import { Button, Card, DetailList, DetailRow, InlineError, PageHeader } from '../../ui/primitives';
import { SelectField, TextField } from '../../ui/form';
import { useForm } from '../../hooks/useForm';
import { useToast } from '../../ui/Toaster';
import { dateLong } from '../../lib/format';

/**
 * Perfil.
 *
 * O fuso horário e as unidades não são preferências cosméticas: definem o que "hoje"
 * significa para o Zemlo. Uma inspeção que expira "hoje" em Lisboa pode expirar amanhã num
 * utilizador em São Paulo — e é a API que calcula os dias restantes com base neste campo.
 * Por isso ele está aqui, à vista, com a explicação do que muda.
 *
 * A moeda é fixa em EUR e não é editável: todo o domínio do Zemlo assume cêntimos de euro, e
 * oferecer uma moeda que o produto não converte seria uma promessa falsa num campo de
 * aparência inocente.
 */
export function ProfileSettingsPage() {
  const { profile, refreshProfile } = useSession();
  const update = useUpdateProfile();
  const toast = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const form = useForm({
    name: profile?.name ?? '',
    timeZone: profile?.timeZone ?? 'Europe/Lisbon',
    locale: profile?.locale ?? 'pt-PT',
    distanceUnit: profile?.distanceUnit ?? 'km',
    volumeUnit: profile?.volumeUnit ?? 'l',
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    try {
      await update.mutateAsync({
        // `null` explícito para o nome vazio: é a forma de o contrato dizer "sem nome",
        // e enviar `''` gravaria uma cadeia vazia que apareceria como um espaço no cabeçalho.
        name: form.values.name.trim() ? form.values.name.trim() : null,
        timeZone: form.values.timeZone,
        locale: form.values.locale as 'pt-PT' | 'en-GB',
        distanceUnit: form.values.distanceUnit as 'km' | 'mi',
        volumeUnit: form.values.volumeUnit as 'l' | 'gal_us' | 'gal_uk',
      });
      await refreshProfile();
      toast.show('Perfil guardado.', { variant: 'ok' });
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
        title="Perfil"
        subtitle="Quem és e como o Zemlo apresenta os teus dados."
        back={{ to: '/settings', label: 'Definições' }}
      />

      <form className="z-stack z-stack--loose" onSubmit={onSubmit} noValidate>
        <Card>
          <div className="z-stack">
            <TextField
              label="Nome"
              value={form.values.name}
              onChange={(event) => form.setValue('name', event.target.value)}
              hint="Aparece na aplicação e nas exportações. Podes deixá-lo vazio."
              error={errors.name}
            />
            <TextField
              label="Email"
              value={profile?.email ?? ''}
              readOnly
              disabled
              hint="O email identifica a conta e não pode ser alterado aqui. Fala com o apoio se precisares de o mudar."
            />
          </div>
        </Card>

        <Card>
          <div className="z-card__header">
            <div>
              <div className="z-card__title">Região e unidades</div>
              <div className="z-card__subtitle">
                Determina o que «hoje» significa e como os valores são apresentados
              </div>
            </div>
          </div>
          <div className="z-stack">
            <SelectField
              label="Fuso horário"
              value={form.values.timeZone}
              onChange={(event) => form.setValue('timeZone', event.target.value)}
              options={[
                { value: 'Europe/Lisbon', label: 'Lisboa (Europa/Lisboa)' },
                { value: 'Atlantic/Azores', label: 'Açores (Atlântico/Açores)' },
                { value: 'Atlantic/Madeira', label: 'Madeira (Atlântico/Madeira)' },
                { value: 'Europe/Madrid', label: 'Madrid (Europa/Madrid)' },
                { value: 'Europe/London', label: 'Londres (Europa/Londres)' },
                { value: 'Europe/Paris', label: 'Paris (Europa/Paris)' },
                { value: 'America/Sao_Paulo', label: 'São Paulo (América/São Paulo)' },
                { value: 'UTC', label: 'UTC' },
              ]}
              hint="Os prazos, os dias restantes e o «hoje» dos registos são todos calculados neste fuso."
              error={errors.timeZone}
            />
            <div className="z-grid z-grid--3">
              <SelectField
                label="Idioma"
                value={form.values.locale}
                onChange={(event) => form.setValue('locale', event.target.value)}
                options={[
                  { value: 'pt-PT', label: 'Português (Portugal)' },
                  { value: 'en-GB', label: 'Inglês (Reino Unido)' },
                ]}
                hint="A interface está em português; este valor acompanha os dados exportados."
                error={errors.locale}
              />
              <SelectField
                label="Distância"
                value={form.values.distanceUnit}
                onChange={(event) => form.setValue('distanceUnit', event.target.value)}
                options={[
                  { value: 'km', label: 'Quilómetros (km)' },
                  { value: 'mi', label: 'Milhas (mi)' },
                ]}
                hint="Internamente tudo é guardado em km; a conversão é só na apresentação."
                error={errors.distanceUnit}
              />
              <SelectField
                label="Volume"
                value={form.values.volumeUnit}
                onChange={(event) => form.setValue('volumeUnit', event.target.value)}
                options={[
                  { value: 'l', label: 'Litros (L)' },
                  { value: 'gal_us', label: 'Galões (EUA)' },
                  { value: 'gal_uk', label: 'Galões (Reino Unido)' },
                ]}
                error={errors.volumeUnit}
              />
            </div>
            <div className="z-field">
              <span className="z-field__label">Moeda</span>
              <span className="z-input" aria-readonly="true" style={{ display: 'flex', alignItems: 'center', background: 'var(--z-bg-sunken)', color: 'var(--z-text-muted)' }}>
                Euro (€)
              </span>
              <span className="z-field__hint">
                Todo o Zemlo trabalha em cêntimos de euro e não converte para outras moedas. Uma
                opção que não faz o que promete é pior do que nenhuma.
              </span>
            </div>
          </div>
        </Card>

        {update.error ? (
          <InlineError message={errorMessage(update.error)} requestId={errorRequestId(update.error)} />
        ) : null}

        <div className="z-row z-row--end" style={{ gap: 'var(--z-space-3)' }}>
          <Link to="/settings" className="z-btn z-btn--secondary">
            Voltar
          </Link>
          <Button type="submit" variant="primary" loading={update.isPending}>
            Guardar perfil
          </Button>
        </div>
      </form>

      <Card soft>
        <DetailList>
          <DetailRow label="Conta criada em" value={profile ? dateLong(profile.createdAt.slice(0, 10)) : '—'} />
          <DetailRow
            label="Verificação em dois passos"
            value={profile?.twoFactorEnabled ? 'ativa' : 'inativa'}
          />
        </DetailList>
      </Card>
    </div>
  );
}
