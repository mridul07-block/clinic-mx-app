-- NOT VALID: enforced for every write from now on; a row checked in before INT-01 may have no
-- arrival time.
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_arrived" CHECK ("appointment"."status" <> 'checked_in' or "appointment"."arrived_at" is not null) NOT VALID;
