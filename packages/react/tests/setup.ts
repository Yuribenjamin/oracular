// React's act() wants to know it is driving the updates; without this flag it warns on every one.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
