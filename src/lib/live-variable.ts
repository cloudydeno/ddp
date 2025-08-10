/**
 * A minimal way of subscribing to a value to receive async updates when it changes.
 * Intended to plug into Meteor's Tracker / ReactiveVar system, but also works without it.
 * Avoids this module depending on Meteor's Tracker concept, so that it can work with other systems.
 *
 * For example, React's useSyncExternalStore should be pluggable with something like this:
 * const snapshot = useSyncExternalStore(liveVar.subscribe, liveVar.getSnapshot)
 */
export class LiveVariable<Tvalue=unknown> {

  constructor(initialValue: Tvalue) {
    this.#value = initialValue;
  }
  #value: Tvalue;

  subscriptions = new Set<() => void>;

  // Explicitly bound to more direclty support React hooks
  // via https://react.dev/reference/react/useSyncExternalStore
  subscribe = (callback: () => void): () => void => {
    this.subscriptions.add(callback);
    return () => {
      this.subscriptions.delete(callback);
    }
  }
  getSnapshot = (): Tvalue => {
    return this.#value;
  }

  setSnapshot(newValue: Tvalue): void {
    this.#value = newValue;

    let caught: unknown = null;
    for (const subscription of this.subscriptions) {
      try {
        subscription();
      } catch (thrown: unknown) {
        caught = thrown;
      }
    }
    if (caught) throw caught;
  }

}
