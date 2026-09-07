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

/*
 * Fila por documento.
 *
 * Aplicar condição, contar exaustão e passar o turno são todos ler-somar-
 * gravar: dois cliques quase juntos leem o mesmo "não existe" e criam dois
 * efeitos iguais. Uma fila por ator faz o segundo esperar o primeiro.
 *
 * Nada dentro de uma tarefa enfileirada pode enfileirar outra tarefa do mesmo
 * ator: a de dentro esperaria a de fora, que espera a de dentro, e o turno
 * trava em silêncio. Por isso o que aplica dano fica fora da fila.
 */
const filas = new Map();

export function naFila(doc, tarefa) {
  const chave = doc?.uuid;
  if (!chave) return tarefa();
  const anterior = filas.get(chave) ?? Promise.resolve();
  const atual = anterior.catch(() => {}).then(tarefa);
  const marcador = atual.catch(() => {}).then(() => {
    if (filas.get(chave) === marcador) filas.delete(chave);
  });
  filas.set(chave, marcador);
  return atual;
}
