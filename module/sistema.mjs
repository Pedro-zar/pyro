/**
 * Identidade do sistema em tempo de execução.
 *
 * O mesmo código roda em duas pastas: "pyro" (a mesa de verdade) e
 * "pyro-dev" (a cópia de desenvolvimento). O Foundry exige que o id do
 * manifesto seja o nome da pasta, e valida esse id em três lugares — o escopo
 * das flags, o namespace das configurações e os caminhos de template e fonte.
 * Escrever "pyro" fixo no código faria a cópia de desenvolvimento quebrar na
 * primeira flag lida; escrever "pyro-dev" faria o contrário na produção.
 *
 * Então o id sai da URL deste próprio arquivo, que o Foundry serve em
 * systems/<id>/module/sistema.mjs. Tudo que precisa do id importa daqui.
 */
export const SYSTEM_ID = (() => {
  const m = /\/systems\/([^/]+)\//.exec(import.meta.url);
  return m?.[1] ?? "pyro";
})();

/** Caminho absoluto dentro do sistema: caminho("templates/x.hbs"). */
export const caminho = relativo => `systems/${SYSTEM_ID}/${relativo}`;

/**
 * Flags do sistema num documento (efeito, mensagem, item). Lê o escopo do id
 * atual e, na falta dele, o escopo "pyro": um documento exportado da mesa de
 * produção e importado na de desenvolvimento continua legível.
 */
export const flagsDe = doc => doc?.flags?.[SYSTEM_ID] ?? doc?.flags?.pyro;

/** Bloco de flags para dados de criação: { [SYSTEM_ID]: dados }. */
export const flagsDoSistema = dados => ({ [SYSTEM_ID]: dados });
