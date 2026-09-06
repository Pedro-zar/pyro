import { PYRO } from "./config.mjs";
import { ConfigElementosApp } from "./apps/config-magia.mjs";
import { ConfigCaminhosApp } from "./apps/config-caminhos.mjs";
import { ConfigProgressaoApp } from "./apps/config-progressao.mjs";
import { SYSTEM_ID } from "./sistema.mjs";

/**
 * Configurações do mundo que alteram as tabelas de magia. Ficam em settings
 * pra cada mesa poder ajustar sem editar o código do sistema.
 */
export function registrarSettings() {
  game.settings.register(SYSTEM_ID, "linguas", {
    scope: "world",
    config: false,
    type: Object,
    default: foundry.utils.deepClone(PYRO.linguasPadrao),
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, "elementos", {
    scope: "world",
    config: false,
    type: Object,
    default: foundry.utils.deepClone(PYRO.elementosPadrao),
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, "racas", {
    scope: "world",
    config: false,
    type: Object,
    default: foundry.utils.deepClone(PYRO.racasPadrao),
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, "recursosCustom", {
    scope: "world",
    config: false,
    type: Object,
    default: foundry.utils.deepClone(PYRO.recursosCustomPadrao),
    requiresReload: true
  });

  /*
   * Regras de progressão: uma habilidade com o nome certo troca a curva de
   * custo do Caminho inteiro. Fica em setting próprio, e não junto das tabelas
   * de magia, porque não tem nada a ver com conjuração.
   */
  game.settings.register(SYSTEM_ID, "progressoes", {
    scope: "world",
    config: false,
    type: Object,
    default: foundry.utils.deepClone(PYRO.progressoesPadrao),
    requiresReload: true
  });

  /*
   * Três telas, uma por assunto. Elementos é a tabela de dano da magia;
   * Caminhos Raciais junta raças, potenciais e recursos, que se referenciam
   * entre si; Progressão é a curva de XP.
   */
  game.settings.registerMenu(SYSTEM_ID, "configMagia", {
    name: "PYRO.Config.Nome",
    label: "PYRO.Config.Botao",
    hint: "PYRO.Config.Dica",
    icon: "fa-solid fa-wand-sparkles",
    type: ConfigElementosApp,
    restricted: true
  });

  game.settings.registerMenu(SYSTEM_ID, "configCaminhos", {
    name: "PYRO.ConfigCaminhos.Nome",
    label: "PYRO.ConfigCaminhos.Botao",
    hint: "PYRO.ConfigCaminhos.Dica",
    icon: "fa-solid fa-users",
    type: ConfigCaminhosApp,
    restricted: true
  });

  game.settings.registerMenu(SYSTEM_ID, "configProgressao", {
    name: "PYRO.Progressao.Nome",
    label: "PYRO.Progressao.Botao",
    hint: "PYRO.Progressao.Dica",
    icon: "fa-solid fa-route",
    type: ConfigProgressaoApp,
    restricted: true
  });
}

/**
 * Junta o que o mestre salvou com a tabela padrão do sistema.
 * O salvo manda nos campos que ele editou, mas campos novos que chegam numa
 * atualização (a corrente do raio, por exemplo) continuam valendo — sem isso,
 * uma configuração salva antes congelaria as tabelas na versão antiga.
 * Entradas que o mestre apagou seguem apagadas; as que ele criou entram como estão.
 */
function mesclar(padrao, salvo) {
  if (!salvo || !Object.keys(salvo).length) return foundry.utils.deepClone(padrao);
  const saida = {};
  for (const [chave, valor] of Object.entries(salvo)) {
    saida[chave] = padrao[chave]
      ? foundry.utils.mergeObject(foundry.utils.deepClone(padrao[chave]), valor, { inplace: false })
      : foundry.utils.deepClone(valor);
  }
  return saida;
}

/** Aplica o que estiver salvo por cima das tabelas padrão. */
export function aplicarSettings() {
  PYRO.linguas = mesclar(PYRO.linguasPadrao, game.settings.get(SYSTEM_ID, "linguas"));
  PYRO.elementos = mesclar(PYRO.elementosPadrao, game.settings.get(SYSTEM_ID, "elementos"));
  PYRO.racas = mesclar(PYRO.racasPadrao, game.settings.get(SYSTEM_ID, "racas"));
  PYRO.recursosCustom = mesclar(PYRO.recursosCustomPadrao, game.settings.get(SYSTEM_ID, "recursosCustom"));
  // A lista de progressões nasce vazia, então vale o que o mestre salvou.
  PYRO.progressoes = foundry.utils.deepClone(game.settings.get(SYSTEM_ID, "progressoes") ?? {});
  PYRO.indexarProgressoes();
}
