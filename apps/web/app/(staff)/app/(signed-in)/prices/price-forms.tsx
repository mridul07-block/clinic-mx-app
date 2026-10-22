'use client';

import { useActionState, useId, useState } from 'react';
import {
  FormMessage,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../../../../components/forms';
import {
  addDiscountPresetAction,
  addPackageTypeAction,
  addPriceItemAction,
  editDiscountPresetAction,
  editPackageTypeAction,
  editPriceItemAction,
  setPriceActiveAction,
  type PriceFormState,
} from '../../../../../modules/prices/actions';

const initialState: PriceFormState = {};

const choiceClass =
  'flex min-h-row items-center gap-3 rounded-control px-1 text-ink pointer-coarse:min-h-row-touch';

const amountHelper = 'In rupees, for example 1,500.';

const valueOf = (
  state: PriceFormState,
  saved: Record<string, string | undefined> | undefined,
  field: string,
) => state.values?.[field] ?? saved?.[field] ?? '';

/** A list price's name and amount (SET-02). */
export function PriceItemForm({
  item,
}: {
  item?: { priceItemId: string; label: string; amount: string };
}) {
  const [state, action, pending] = useActionState(
    item ? editPriceItemAction : addPriceItemAction,
    initialState,
  );
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {item ? <input type="hidden" name="priceItemId" value={item.priceItemId} /> : null}
      <TextField
        label="Name"
        name="label"
        autoComplete="off"
        maxLength={60}
        defaultValue={valueOf(state, item, 'label')}
        helper={item ? undefined : 'As it appears on bills, for example Dry needling.'}
        error={state.fieldErrors?.label}
      />
      <TextField
        label="Price"
        name="amount"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={valueOf(state, item, 'amount')}
        helper={amountHelper}
        error={state.fieldErrors?.amount}
      />
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Saving' : item ? 'Save price' : 'Add price'}
      </button>
    </form>
  );
}

export interface PackageTypeFormValues {
  packageTypeId: string;
  name: string;
  sessions: string;
  price: string;
  itemIds: string[];
}

/**
 * A package type: its sessions, its price and the price items it covers (SET-02). Validity and
 * reschedules are clinic-wide settings, so they are not asked here.
 */
export function PackageTypeForm({
  packageType,
  items,
}: {
  packageType?: PackageTypeFormValues;
  /** The price items to choose from: active ones, and any inactive one already covered. */
  items: { id: string; label: string; price: string; active: boolean }[];
}) {
  const [state, action, pending] = useActionState(
    packageType ? editPackageTypeAction : addPackageTypeAction,
    initialState,
  );
  const id = useId();
  const chosen = new Set(state.itemIds ?? packageType?.itemIds ?? []);
  const values = packageType && {
    name: packageType.name,
    sessions: packageType.sessions,
    price: packageType.price,
  };
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {packageType ? (
        <input type="hidden" name="packageTypeId" value={packageType.packageTypeId} />
      ) : null}
      <TextField
        label="Name"
        name="name"
        autoComplete="off"
        maxLength={60}
        defaultValue={valueOf(state, values, 'name')}
        helper="As patients see it on the plan and the invoice."
        error={state.fieldErrors?.name}
      />
      <TextField
        label="Sessions"
        name="sessions"
        inputMode="numeric"
        autoComplete="off"
        defaultValue={valueOf(state, values, 'sessions')}
        error={state.fieldErrors?.sessions}
      />
      <TextField
        label="Package price"
        name="price"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={valueOf(state, values, 'price')}
        helper="What the patient pays for the whole package, in rupees."
        error={state.fieldErrors?.price}
      />
      <fieldset
        className="flex flex-col gap-1"
        aria-describedby={state.fieldErrors?.itemIds ? `${id}-items-error` : undefined}
      >
        <legend className="mb-1 font-medium text-ink">Covers</legend>
        {items.map((item) => (
          <label key={item.id} className={choiceClass}>
            <input
              type="checkbox"
              name="itemIds"
              value={item.id}
              defaultChecked={chosen.has(item.id)}
              className="size-4 accent-accent"
            />
            <span className="flex flex-1 flex-wrap justify-between gap-x-3">
              <span>
                {item.label}
                {item.active ? null : <span className="text-ink-muted"> (inactive)</span>}
              </span>
              <span className="text-ink-secondary tabular-nums">{item.price}</span>
            </span>
          </label>
        ))}
        {state.fieldErrors?.itemIds ? (
          <p id={`${id}-items-error`} className="text-sm text-danger">
            {state.fieldErrors.itemIds}
          </p>
        ) : null}
      </fieldset>
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Saving' : packageType ? 'Save package type' : 'Add package type'}
      </button>
    </form>
  );
}

export interface DiscountPresetFormValues {
  discountPresetId: string;
  name: string;
  kind: 'percent' | 'flat';
  percent: string;
  amount: string;
}

/** A preset discount: a whole percent or a flat amount off (SET-02). */
export function DiscountPresetForm({ discount }: { discount?: DiscountPresetFormValues }) {
  const [state, action, pending] = useActionState(
    discount ? editDiscountPresetAction : addDiscountPresetAction,
    initialState,
  );
  const [kind, setKind] = useState(state.values?.kind ?? discount?.kind ?? 'percent');
  const values = discount && {
    name: discount.name,
    percent: discount.percent,
    amount: discount.amount,
  };
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {discount ? (
        <input type="hidden" name="discountPresetId" value={discount.discountPresetId} />
      ) : null}
      <TextField
        label="Name"
        name="name"
        autoComplete="off"
        maxLength={60}
        defaultValue={valueOf(state, values, 'name')}
        helper="Who it is for, for example Runners’ club."
        error={state.fieldErrors?.name}
      />
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium text-ink">Discount</legend>
        {(
          [
            ['percent', 'A percent off'],
            ['flat', 'A flat amount off'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className={choiceClass}>
            <input
              type="radio"
              name="kind"
              value={value}
              checked={kind === value}
              onChange={() => {
                setKind(value);
              }}
              className="size-4 accent-accent"
            />
            <span>{label}</span>
          </label>
        ))}
        {state.fieldErrors?.kind ? (
          <p className="text-sm text-danger">{state.fieldErrors.kind}</p>
        ) : null}
      </fieldset>
      {kind === 'flat' ? (
        <TextField
          key="amount"
          label="Amount off"
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={valueOf(state, values, 'amount')}
          helper={amountHelper}
          error={state.fieldErrors?.amount}
        />
      ) : (
        <TextField
          key="percent"
          label="Percent off"
          name="percent"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={valueOf(state, values, 'percent')}
          helper="A whole number from 1 to 100."
          error={state.fieldErrors?.percent}
        />
      )}
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Saving' : discount ? 'Save discount' : 'Add discount'}
      </button>
    </form>
  );
}

/**
 * Deactivates a price item, package type or discount after a confirm step (it is kept, and no
 * longer offered for new bills), or reactivates it.
 */
export function PriceActiveForm({
  what,
  id,
  name,
  noun,
  active,
}: {
  what: 'items' | 'packages' | 'discounts';
  id: string;
  name: string;
  /** What it is called in the buttons: price, package type, discount. */
  noun: string;
  active: boolean;
}) {
  const [state, action, pending] = useActionState(setPriceActiveAction, initialState);
  const [confirming, setConfirming] = useState(false);
  if (active && !confirming) {
    return (
      <button
        type="button"
        className={secondaryButtonClass}
        onClick={() => {
          setConfirming(true);
        }}
      >
        Deactivate {noun}
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <input type="hidden" name="what" value={what} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? 'false' : 'true'} />
      {active ? (
        <>
          <p className="text-ink-secondary">
            Deactivate {name}? It is no longer offered for new bills. Bills already made and its
            history stay.
          </p>
          <button type="submit" disabled={pending} className={dangerButtonClass}>
            {pending ? 'Deactivating' : `Deactivate ${noun}`}
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => {
              setConfirming(false);
            }}
          >
            Keep it active
          </button>
        </>
      ) : (
        <button type="submit" disabled={pending} className={secondaryButtonClass}>
          {pending ? 'Reactivating' : `Reactivate ${noun}`}
        </button>
      )}
    </form>
  );
}
