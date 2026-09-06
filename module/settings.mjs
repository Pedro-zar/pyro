import { PYRO } from "./config.mjs";
import { ConfigElementosApp } from "./apps/config-magia.mjs";
import { ConfigCaminhosApp } from "./apps/config-caminhos.mjs";
import { ConfigProgressaoApp } from "./apps/config-progressao.mjs";
import { ConfigRegrasApp } from "./apps/config-regras.mjs";
import { SYSTEM_ID } from "./sistema.mjs";

/**
 * Configurações do mundo: as tabelas de regras que o mestre edita (línguas,
 * elementos, raças, recursos, progressões) e os menus que as abrem. Ficam em
 * settings pra cada mesa poder ajustar sem editar o código do sistema.
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
  // Tabelas de nível por uso, uma por trilha (perícia; magia e técnica).
  game.settings.register(SYSTEM_ID, "avancoPorUso", {
    scope: "world",
    config: false,
    type: Object,
    default: foundry.utils.deepClone(PYRO.avancoPorUsoPadrao),
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, "curvaXp", {
    scope: "world",
    config: false,
    type: Object,
    default: foundry.utils.deepClone(PYRO.curvaXpPadrao),
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, "regrasOpcionais", {
    scope: "world",
    config: false,
    type: Object,
    default: Object.fromEntries(Object.keys(PYRO.regrasOpcionais).map(k => [k, false])),
    requiresReload: true
  });

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

  game.settings.registerMenu(SYSTEM_ID, "configRegras", {
    name: "PYRO.Regras.Nome",
    label: "PYRO.Regras.Botao",
    hint: "PYRO.Regras.Dica",
    icon: "fa-solid fa-toggle-on",
    type: ConfigRegrasApp,
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
 * atualização (a corrente do raio, por exemplo) continuam valendo — senão uma
 * configuração salva congelaria as tabelas na versão em que foi salva.
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
  PYRO.curvaXp = { ...PYRO.curvaXpPadrao, ...(game.settings.get(SYSTEM_ID, "curvaXp") ?? {}) };
  PYRO.regrasAtivas = { ...(game.settings.get(SYSTEM_ID, "regrasOpcionais") ?? {}) };
  // Cada trilha é substituída inteira: uma tabela é um array, e mesclar
  // linha a linha misturaria uma tabela editada com a padrão.
  const avanco = game.settings.get(SYSTEM_ID, "avancoPorUso") ?? {};
  PYRO.avancoPorUso = {
    ...foundry.utils.deepClone(PYRO.avancoPorUsoPadrao),
    ...Object.fromEntries(Object.entries(avanco).filter(([, tabela]) => Array.isArray(tabela) && tabela.length))
  };
}
