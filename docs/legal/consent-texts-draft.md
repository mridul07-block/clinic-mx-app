# Consent texts: drafts for the clinic's clinical lead and lawyer (OPS-07, decision 21)

**Status:** drafts by Velyx Labs, written in the style of the Blueprint's other Part B statements
so the clinic has a starting point. They are **not in the software**. Until the clinic sends final
wording, Dry needling and the Zero Gravity Treadmill are never asked and never used
(`docs/runbooks/consent.md`, DECISION #21). The clinical lead checks the risks and precautions; the
lawyer checks the consent. Once approved, the final words go into the software as version 1 of each
statement, and patients are asked them.

## Dry needling

> I understand that dry needling uses fine, sterile, single-use needles inserted into muscles and
> other soft tissues to help reduce pain and improve movement in selected musculoskeletal
> conditions. Possible side effects include soreness, bruising, minor bleeding, light-headedness or
> fainting, and temporary worsening of symptoms; serious complications such as infection or, when
> needling near the chest wall, a collapsed lung are rare. I have disclosed relevant medical
> conditions, bleeding disorders, blood-thinning medication, pregnancy where applicable, diabetes,
> a weakened immune system, metal allergy and any fear of needles to my physiotherapist. I
> understand that treatment outcomes are not guaranteed and voluntarily consent to this treatment.

For the clinical lead:

- Is the list of side effects and disclosures complete for how the clinic practises?
- Should the patient be told how they can stop during the treatment?

## Zero Gravity Treadmill

> I understand that the Zero Gravity Treadmill reduces the body weight I carry while walking or
> running, using air pressure around my lower body, to help me exercise with less load during
> rehabilitation. Possible side effects include discomfort from the fitted shorts or the pressure,
> skin irritation, light-headedness, muscle soreness, and a risk of tripping or falling. I have
> disclosed relevant medical conditions, recent surgery or wounds around the waist or legs, heart
> or blood pressure problems, hernia, and pregnancy where applicable to my physiotherapist. I
> understand that I must follow the supervising physiotherapist's instructions and that treatment
> outcomes are not guaranteed, and I voluntarily consent to this treatment.

For the clinical lead:

- Which machine does the clinic use (differential air pressure or harness)? The text assumes air
  pressure.
- Which contraindications does the manufacturer list?

## Marketing tick box (optional)

Decision 21 asks whether patients are offered marketing messages. If the clinic wants it, a
separate, unticked box on the health form:

> ☐ I would like to receive news and offers from Movementology Clinics on WhatsApp. I can stop
> them at any time by replying STOP.

Notes:

- **Not built yet:** the software has no marketing tick box, no marketing message, and no STOP
  handling. Adding them is a ticket once the clinic decides.
- **Templates:** Meta needs marketing templates approved separately from utility ones.
- **Consent rules:** the box must be optional and must not hold up care (DPDP consent must be
  specific and free).
