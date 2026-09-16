import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { FUEL_TYPES, normalizePlate, optionLabel, VEHICLE_TYPES } from '@zemlo/shared';
import { useCreateVehicle, useRecordOdometer } from '../../api/hooks';
import { ApiError } from '../../api/client';
import { useForm } from '../../hooks/useForm';
import { Button, Card, PageHeader } from '../../ui/primitives';
import { DateField, Field, MoneyField, NumberField, SelectField, TextAreaField, TextField } from '../../ui/form';
import { amountOrUndefined, integerOrUndefined, textOrUndefined } from '../../lib/formPayload';
import { km } from '../../lib/format';

/**
 * Adicionar veículo.
 *
 * A regra da §5 é o que dá forma a este ecrã: **só a matrícula é obrigatória**, e tudo o
 * resto é enriquecimento progressivo (§6). Mas um formulário em que tudo o resto está
 * escondido obriga a procurá-lo mais tarde; por isso a estrutura é:
 *
 *  - matrícula à vista, com pré-visualização normalizada;
 *  - quilometragem logo a seguir, porque é o que faz o painel responder a perguntas;
 *  - **"Detalhes do veículo"** atrás de uma divulgação, com os campos técnicos
 *    (combustível, potência, VIN, bateria, depósito, pneus) — todos opcionais, todos
 *    editáveis mais tarde na ficha.
 *
 * O `fuelType` fica na divulgação e não à vista porque a maior parte das pessoas não sabe
 * o código exato do combustível do seu carro — sabe a matrícula. E porque o Zemlo funciona
 * sem ele: as estatísticas de consumo aparecem quando houver abastecimentos, não quando
 * houver um código.
 */
export function NewVehiclePage() {
  const navigate = useNavigate();
  const create = useCreateVehicle();
  const odometer = useRecordOdometer(undefined);
  const form = useForm({
    plate: '',
    odometerKm: '',
    make: '',
    model: '',
    version: '',
    year: '',
    vehicleType: 'car',
    fuelType: '',
    nickname: '',
    color: '',
    vin: '',
    powerCv: '',
    tankCapacityL: '',
    batteryCapacityKwh: '',
    tyreSize: '',
    purchaseDate: '',
    purchasePrice: '',
    purchaseOdometerKm: '',
    notes: '',
  });
  const [error, setError] = useState<unknown>(null);
  const normalized = normalizePlate(form.values.plate);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    form.clearErrors();
    form.setSubmitting(true);
    try {
      const payload: Record<string, unknown> = { plate: form.values.plate };

      // Campos de texto: só entram no corpo quando têm conteúdo. Enviar `make: ''` gravaria
      // uma cadeia vazia e o construtor apareceria como um espaço em branco na interface.
      for (const key of ['make', 'model', 'version', 'nickname', 'color', 'vin', 'tyreSize', 'notes'] as const) {
        const value = textOrUndefined(form.values[key]);
        if (value !== undefined) payload[key] = value;
      }
      for (const key of ['year', 'powerCv', 'purchaseOdometerKm'] as const) {
        const value = integerOrUndefined(form.values[key]);
        if (value !== undefined) payload[key] = value;
      }
      if (form.values.vehicleType) payload.vehicleType = form.values.vehicleType;
      if (form.values.fuelType) payload.fuelType = form.values.fuelType;
      const tank = integerOrUndefined(form.values.tankCapacityL);
      if (tank !== undefined) payload.tankCapacityL = tank;
      const battery = integerOrUndefined(form.values.batteryCapacityKwh);
      if (battery !== undefined) payload.batteryCapacityKwh = battery;
      const purchasePrice = amountOrUndefined(form.values.purchasePrice);
      if (purchasePrice !== undefined) payload.purchasePriceCents = purchasePrice;
      const purchaseDate = textOrUndefined(form.values.purchaseDate);
      if (purchaseDate !== undefined) payload.purchaseDate = purchaseDate;

      const vehicle = await create.mutateAsync(payload as never);

      const kilometres = integerOrUndefined(form.values.odometerKm);
      if (kilometres !== undefined) {
        // A quilometragem é registada depois de o veículo existir, mas o utilizador não vê
        // dois passos: o pedido de odómetro vai logo a seguir e o ecrã navega para a ficha.
        // Uma quilometragem a recuar aqui não pede confirmação: é o primeiro registo do
        // veículo, pelo que não há leitura anterior com que comparar.
        await odometer.submit({ odometerKm: kilometres });
      }

      navigate(`/vehicles/${vehicle.id}`, { replace: true });
    } catch (caught) {
      setError(caught);
      form.setServerError(caught);
    } finally {
      form.setSubmitting(false);
    }
  }

  const errors: Record<string, string> = {};
  if (error instanceof ApiError) {
    for (const field of error.fields) errors[field.path] = field.message;
  }

  return (
    <div className="z-page">
      <PageHeader
        title="Adicionar veículo"
        subtitle="Só a matrícula é obrigatória."
        back={{ to: '/vehicles', label: 'Veículos' }}
      />

      <form className="z-stack z-stack--loose" onSubmit={onSubmit} noValidate>
        <Card>
          <div className="z-stack">
            <Field
              label="Matrícula"
              required
              hint={
                normalized.value
                  ? normalized.valid
                    ? `Vamos guardar como ${normalized.display}.`
                    : 'Matrículas estrangeiras ou atípicas são aceites tal como as escreveres.'
                  : 'Com ou sem hífenes, maiúsculas ou minúsculas.'
              }
              error={form.fieldError('plate') ?? errors.plate}
            >
              {({ inputId, describedBy }) => (
                <input
                  id={inputId}
                  className="z-input"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  autoFocus
                  placeholder="42-38-EL"
                  value={form.values.plate}
                  onChange={(event) => form.setValue('plate', event.target.value)}
                  aria-describedby={describedBy}
                  aria-invalid={form.fieldError('plate') ?? errors.plate ? true : undefined}
                />
              )}
            </Field>

            <NumberField
              label="Quilometragem atual"
              suffix="km"
              hint="Opcional, mas sem ela não conseguimos calcular o custo por km nem prever a próxima revisão."
              value={form.values.odometerKm}
              onChange={(value) => form.setValue('odometerKm', value)}
              error={form.fieldError('odometerKm') ?? errors.odometerKm}
            />

            <TextField
              label="Apelido"
              placeholder="O carro da família, o elétrico…"
              hint="Aparece em vez do construtor e do modelo, onde houver pouco espaço."
              value={form.values.nickname}
              onChange={(event) => form.setValue('nickname', event.target.value)}
              error={form.fieldError('nickname') ?? errors.nickname}
            />
          </div>
        </Card>

        <details className="z-card" style={{ display: 'block' }}>
          <summary className="z-disclosure__toggle" style={{ listStyle: 'none', display: 'flex' }}>
            Detalhes do veículo (opcional)
            <span aria-hidden="true">›</span>
          </summary>

          <div className="z-stack" style={{ paddingTop: 'var(--z-space-4)' }}>
            <div className="z-grid z-grid--2">
              <SelectField
                label="Tipo"
                value={form.values.vehicleType}
                onChange={(event) => form.setValue('vehicleType', event.target.value)}
                options={VEHICLE_TYPES.map((type) => ({ value: type.code, label: `${type.icon} ${type.label}` }))}
                error={form.fieldError('vehicleType') ?? errors.vehicleType}
              />
              <SelectField
                label="Propulsão"
                placeholder="Não sei / prefiro não indicar"
                value={form.values.fuelType}
                onChange={(event) => form.setValue('fuelType', event.target.value)}
                options={FUEL_TYPES.map((type) => ({ value: type.code, label: optionLabel(FUEL_TYPES, type.code) }))}
                error={form.fieldError('fuelType') ?? errors.fuelType}
              />
            </div>

            <div className="z-grid z-grid--3">
              <TextField
                label="Marca"
                value={form.values.make}
                onChange={(event) => form.setValue('make', event.target.value)}
                error={form.fieldError('make') ?? errors.make}
              />
              <TextField
                label="Modelo"
                value={form.values.model}
                onChange={(event) => form.setValue('model', event.target.value)}
                error={form.fieldError('model') ?? errors.model}
              />
              <NumberField
                label="Ano"
                value={form.values.year}
                onChange={(value) => form.setValue('year', value)}
                error={form.fieldError('year') ?? errors.year}
              />
            </div>

            <TextField
              label="Versão"
              placeholder="GT-Line 81 kWh, xDrive20d M Sport…"
              value={form.values.version}
              onChange={(event) => form.setValue('version', event.target.value)}
              error={form.fieldError('version') ?? errors.version}
            />

            <div className="z-grid z-grid--2">
              <TextField
                label="Cor"
                value={form.values.color}
                onChange={(event) => form.setValue('color', event.target.value)}
                error={form.fieldError('color') ?? errors.color}
              />
              <TextField
                label="Número de chassis (VIN)"
                value={form.values.vin}
                onChange={(event) => form.setValue('vin', event.target.value)}
                hint="17 caracteres. Útil quando houver integrações ou seguros a ligar-se ao veículo."
                error={form.fieldError('vin') ?? errors.vin}
              />
            </div>

            <div className="z-grid z-grid--3">
              <NumberField
                label="Potência"
                suffix="cv"
                value={form.values.powerCv}
                onChange={(value) => form.setValue('powerCv', value)}
                error={form.fieldError('powerCv') ?? errors.powerCv}
              />
              <NumberField
                label="Depósito"
                suffix="L"
                value={form.values.tankCapacityL}
                onChange={(value) => form.setValue('tankCapacityL', value)}
                error={form.fieldError('tankCapacityL') ?? errors.tankCapacityL}
              />
              <NumberField
                label="Bateria"
                suffix="kWh"
                value={form.values.batteryCapacityKwh}
                onChange={(value) => form.setValue('batteryCapacityKwh', value)}
                error={form.fieldError('batteryCapacityKwh') ?? errors.batteryCapacityKwh}
              />
            </div>

            <TextField
              label="Medida dos pneus"
              placeholder="215/60 R17"
              value={form.values.tyreSize}
              onChange={(event) => form.setValue('tyreSize', event.target.value)}
              error={form.fieldError('tyreSize') ?? errors.tyreSize}
            />

            <div className="z-grid z-grid--3">
              <MoneyField
                label="Preço de compra"
                value={form.values.purchasePrice}
                onChange={(value) => form.setValue('purchasePrice', value)}
                hint="Permite estimar a depreciação nas estatísticas avançadas."
                error={form.fieldError('purchasePriceCents') ?? errors.purchasePriceCents}
              />
              <NumberField
                label="Km na compra"
                suffix="km"
                value={form.values.purchaseOdometerKm}
                onChange={(value) => form.setValue('purchaseOdometerKm', value)}
                error={form.fieldError('purchaseOdometerKm') ?? errors.purchaseOdometerKm}
              />
              <DateField
                label="Data da compra"
                value={form.values.purchaseDate}
                onChange={(event) => form.setValue('purchaseDate', event.target.value)}
                error={form.fieldError('purchaseDate') ?? errors.purchaseDate}
              />
            </div>

            <TextAreaField
              label="Notas"
              value={form.values.notes}
              onChange={(event) => form.setValue('notes', event.target.value)}
            />
          </div>
        </details>

        {create.error ? (
          <div className="z-inline-error" role="alert">
            <span>{create.error instanceof ApiError ? create.error.message : 'Não foi possível guardar o veículo.'}</span>
            {create.error instanceof ApiError && create.error.requestId ? (
              <span className="z-request-id">Referência para apoio: {create.error.requestId}</span>
            ) : null}
          </div>
        ) : null}

        <div className="z-row z-row--end" style={{ gap: 'var(--z-space-3)' }}>
          <Button variant="secondary" type="button" onClick={() => navigate('/vehicles')}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" loading={form.isSubmitting}>
            Guardar veículo
          </Button>
        </div>

        <p className="z-xs z-muted">
          {normalized.valid && normalized.value
            ? `Vais guardar ${normalized.display}.`
            : 'Escreve a matrícula para continuar.'}
          {form.values.odometerKm && integerOrUndefined(form.values.odometerKm) !== undefined
            ? ` Primeira leitura: ${km(integerOrUndefined(form.values.odometerKm) as number)}.`
            : ''}
        </p>
      </form>
    </div>
  );
}
