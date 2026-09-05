export default class DisabledProvider {
  constructor() { throw new Error('Model providers are disabled in the browser preview.'); }
}
