'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import {
  PriceError,
  addDiscountPreset,
  addPackageType,
  addPriceItem,
  editDiscountPreset,
  editPackageType,
  editPriceItem,
  setDiscountPresetActiveService,
  setPackageTypeActiveService,
  setPriceItemActiveService,
} from './services';

/** What a price master form shows after a post (SET-02). */
export interface PriceFormState {
  error?: string;
  /** Messages by field. */
  fieldErrors?: Record<string, string>;
  /** What was typed, given back with an error so the form keeps it. */
  values?: Record<string, string>;
  /** The covered items chosen on a package type form. */
  itemIds?: string[];
}

const LIST = '/app/prices';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Refusals and bad input become messages; anything else is ours and is thrown. */
function failure(error: unknown): PriceFormState {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const field = issue.path.find((part) => typeof part === 'string') ?? 'form';
      fieldErrors[field] ??= issue.message;
    }
    return { error: 'Check the highlighted fields.', fieldErrors };
  }
  if (error instanceof PriceError || error instanceof ReadOnlyError) {
    return { error: error.message };
  }
  if (error instanceof NotAllowedError) return { error: 'You do not have access to prices.' };
  throw error;
}

const done = (path: string, id: string, what: string): never => {
  revalidatePath(LIST);
  redirect(`${LIST}/${path}/${id}?done=${what}`);
};

// Price items.

const itemFrom = (form: FormData) => ({
  label: text(form, 'label'),
  amount: text(form, 'amount'),
});

export async function addPriceItemAction(
  _state: PriceFormState,
  form: FormData,
): Promise<PriceFormState> {
  const values = itemFrom(form);
  let id: string;
  try {
    id = await addPriceItem(await serviceContext(), values);
  } catch (error) {
    return { ...failure(error), values };
  }
  return done('items', id, 'added');
}

export async function editPriceItemAction(
  _state: PriceFormState,
  form: FormData,
): Promise<PriceFormState> {
  const values = itemFrom(form);
  const priceItemId = text(form, 'priceItemId');
  try {
    await editPriceItem(await serviceContext(), { priceItemId, ...values });
  } catch (error) {
    return { ...failure(error), values };
  }
  return done('items', priceItemId, 'saved');
}

// Package types.

const packageFrom = (form: FormData) => ({
  name: text(form, 'name'),
  sessions: text(form, 'sessions'),
  price: text(form, 'price'),
});

const itemIdsFrom = (form: FormData) =>
  form.getAll('itemIds').filter((id): id is string => typeof id === 'string');

export async function addPackageTypeAction(
  _state: PriceFormState,
  form: FormData,
): Promise<PriceFormState> {
  const values = packageFrom(form);
  const itemIds = itemIdsFrom(form);
  let id: string;
  try {
    id = await addPackageType(await serviceContext(), { ...values, itemIds });
  } catch (error) {
    return { ...failure(error), values, itemIds };
  }
  return done('packages', id, 'added');
}

export async function editPackageTypeAction(
  _state: PriceFormState,
  form: FormData,
): Promise<PriceFormState> {
  const values = packageFrom(form);
  const itemIds = itemIdsFrom(form);
  const packageTypeId = text(form, 'packageTypeId');
  try {
    await editPackageType(await serviceContext(), { packageTypeId, ...values, itemIds });
  } catch (error) {
    return { ...failure(error), values, itemIds };
  }
  return done('packages', packageTypeId, 'saved');
}

// Preset discounts.

const discountFrom = (form: FormData) => ({
  name: text(form, 'name'),
  kind: text(form, 'kind'),
  percent: text(form, 'percent'),
  amount: text(form, 'amount'),
});

export async function addDiscountPresetAction(
  _state: PriceFormState,
  form: FormData,
): Promise<PriceFormState> {
  const values = discountFrom(form);
  let id: string;
  try {
    id = await addDiscountPreset(await serviceContext(), values);
  } catch (error) {
    return { ...failure(error), values };
  }
  return done('discounts', id, 'added');
}

export async function editDiscountPresetAction(
  _state: PriceFormState,
  form: FormData,
): Promise<PriceFormState> {
  const values = discountFrom(form);
  const discountPresetId = text(form, 'discountPresetId');
  try {
    await editDiscountPreset(await serviceContext(), { discountPresetId, ...values });
  } catch (error) {
    return { ...failure(error), values };
  }
  return done('discounts', discountPresetId, 'saved');
}

// Deactivating and reactivating any of the three.

const setActive = {
  items: (id: string, active: boolean) =>
    serviceContext().then((context) =>
      setPriceItemActiveService(context, { priceItemId: id, active }),
    ),
  packages: (id: string, active: boolean) =>
    serviceContext().then((context) =>
      setPackageTypeActiveService(context, { packageTypeId: id, active }),
    ),
  discounts: (id: string, active: boolean) =>
    serviceContext().then((context) =>
      setDiscountPresetActiveService(context, { discountPresetId: id, active }),
    ),
};

export async function setPriceActiveAction(
  _state: PriceFormState,
  form: FormData,
): Promise<PriceFormState> {
  const what = text(form, 'what');
  if (what !== 'items' && what !== 'packages' && what !== 'discounts') {
    return { error: 'That was not found.' };
  }
  const id = text(form, 'id');
  const active = text(form, 'active') === 'true';
  try {
    await setActive[what](id, active);
  } catch (error) {
    return failure(error);
  }
  return done(what, id, active ? 'reactivated' : 'deactivated');
}
