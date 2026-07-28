import { helper } from './a';

function connect(fn: () => number) {
  return fn;
}

export default connect(helper);
