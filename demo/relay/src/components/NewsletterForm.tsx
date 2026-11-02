import { Track } from '@astroscope/relay/react';
import { track } from '@astroscope/relay/track';
import { actions } from 'astro:actions';
import { type SubmitEvent, useState } from 'react';
import { newsletterEvent, viewFormEvent } from '../relay/events';

export default function NewsletterForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    // the request carries the consent header the bus writes onto every same-origin fetch
    const { data, error } = await actions.subscribe({ email });

    if (error) {
      setStatus(`${error.code}: ${error.message}`);

      return;
    }

    // the browser fires the same conversion under the server's id, so every destination counts it once
    track(newsletterEvent({ id: data.eventId, email }));
    setStatus(`subscribed ${data.subscribed}, event ${data.eventId}`);
  }

  return (
    <form onSubmit={submit} className="flex gap-2 items-end">
      <Track event={viewFormEvent('newsletter')} />
      <label className="form-control">
        <span className="label-text">Email</span>
        <input
          type="email"
          className="input input-bordered"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          maxLength={200}
          required
        />
      </label>
      <button className="btn btn-primary">Subscribe</button>
      {status && <span className="text-sm">{status}</span>}
    </form>
  );
}
