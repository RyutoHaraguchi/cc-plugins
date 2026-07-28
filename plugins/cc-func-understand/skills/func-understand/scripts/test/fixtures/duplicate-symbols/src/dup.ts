export class AdminService {
  save(x: string): string { return "admin:" + x; }
}

export class UserService {
  save(x: string): string { return "user:" + x; }
}

export const save = (x: string): string => "fn:" + x;

export default () => "anonymous";
