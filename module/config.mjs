/**
 * Dados de configuração do PYRO. Tudo que é tabela de regras vive aqui.
 * Línguas/potenciais e elementos podem ser editados pelo mestre nas
 * configurações do mundo (ver settings.mjs) — por isso são dados puros,
 * sem funções, e reconstruídos no init.
 */
export const PYRO = {};

/* -------------------------------------------------------------------------- */
/*  Atributos                                                                 */
/* -------------------------------------------------------------------------- */

PYRO.atributos = {
  for: "PYRO.Atributos.for",
  vig: "PYRO.Atributos.vig",
  des: "PYRO.Atributos.des",
  agi: "PYRO.Atributos.agi",
  int: "PYRO.Atributos.int",
  sab: "PYRO.Atributos.sab",
  pre: "PYRO.Atributos.pre"
};

/** Tabela de Dados (SRD): índice = valor do atributo (1–50). */
PYRO.tabelaDados = [null,
  "1",    "1d2",  "1d4",  "1d6",  "1d8",  "1d10", "1d12", "2d6",  "2d8",  "3d6",
  "2d10", "2d12", "3d8",  "4d6",  "3d10", "5d6",  "4d8",  "3d12", "6d6",  "4d10",
  "5d8",  "7d6",  "4d12", "6d8",  "5d10", "8d6",  "9d6",  "5d12", "6d10", "10d6",
  "8d8",  "7d10", "6d12", "9d8",  "12d6", "8d10", "10d8", "7d12", "14d6", "9d10",
  "8d12", "15d6", "12d8", "10d10","16d6", "9d12", "17d6", "11d10","18d6", "10d12"
];

/* -------------------------------------------------------------------------- */
/*  Dano e defesas                                                            */
/* -------------------------------------------------------------------------- */

PYRO.categoriasDano = {
  fisico: "PYRO.Dano.fisico",
  energetico: "PYRO.Dano.energetico",
  mental: "PYRO.Dano.mental"
};

PYRO.tiposDano = {
  impacto:    { label: "PYRO.Dano.impacto",    categoria: "fisico" },
  cortante:   { label: "PYRO.Dano.cortante",   categoria: "fisico" },
  perfurante: { label: "PYRO.Dano.perfurante", categoria: "fisico" },
  calor:      { label: "PYRO.Dano.calor",      categoria: "energetico" },
  frio:       { label: "PYRO.Dano.frio",       categoria: "energetico" },
  energia:    { label: "PYRO.Dano.energia",    categoria: "energetico" },
  mental:     { label: "PYRO.Dano.mentalTipo", categoria: "mental" }
};

/* -------------------------------------------------------------------------- */
/*  Tamanho e carga                                                           */
/* -------------------------------------------------------------------------- */

// multCarga: capacidade = FOR x mult (SRD: pequena 1x, média 2x, grande 3x).
// token: lado do token em quadrados do grid (o mapa usa 1m por quadrado).
// AJUSTE: as medidas de token são estimativas, já que o SRD só nomeia as
// categorias — ajuste aqui se a sua mesa usar outra escala.
PYRO.tamanhos = {
  minusculo: { label: "PYRO.Tamanhos.minusculo", multCarga: 1, token: 0.25 },
  pequenino: { label: "PYRO.Tamanhos.pequenino", multCarga: 1, token: 0.5 },
  pequeno:   { label: "PYRO.Tamanhos.pequeno",   multCarga: 1, token: 1 },
  medio:     { label: "PYRO.Tamanhos.medio",     multCarga: 2, token: 1 },
  grande:    { label: "PYRO.Tamanhos.grande",    multCarga: 3, token: 2 },
  gigante:   { label: "PYRO.Tamanhos.gigante",   multCarga: 3, token: 3 },
  massivo:   { label: "PYRO.Tamanhos.massivo",   multCarga: 3, token: 4 },
  colossal:  { label: "PYRO.Tamanhos.colossal",  multCarga: 3, token: 6 }
};

PYRO.partesCorpo = {
  cabeca: "PYRO.Partes.cabeca",
  peitoral: "PYRO.Partes.peitoral",
  costas: "PYRO.Partes.costas",
  cintura: "PYRO.Partes.cintura",
  pescoco: "PYRO.Partes.pescoco",
  aneis: "PYRO.Partes.aneis",
  maos: "PYRO.Partes.maos",
  pes: "PYRO.Partes.pes"
};

/** Munição é presa ao corpo em poucos lugares. */
PYRO.partesMunicao = ["costas", "cintura"];

/* -------------------------------------------------------------------------- */
/*  Magia                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Elementos. Os dados de dano seguem a mesma fórmula dos escalonamentos:
 *   nº de dados = base + floor(porIntencao x (Intenção - 1))
 * Conferindo com a tabela do SRD: fogo 3N d6 (3/3), água e vento 4N d4 (4/4),
 * gelo (2N+2) d8 (4/2), terra (2N+1) d12 (3/2), raio 2+floor((N-1)/2) d10
 * (2/0.5), vida 4N d8 (4/4), mente N d6 (1/1), morte 2N d12 (2/2).
 * faces 0 = elemento sem dano padrão (Espaço).
 * grupo = afinidade que libera este elemento (Água e Gelo compartilham).
 */
PYRO.elementosPadrao = {
  fogo:   { label: "PYRO.Elementos.fogo",   grupo: "fogo",       tipoDano: "calor",   base: 3, porIntencao: 3,   faces: 6,  efeito: "PYRO.Elementos.Efeito.fogo" },
  agua:   { label: "PYRO.Elementos.agua",   grupo: "aguaGelo",   tipoDano: "impacto", base: 4, porIntencao: 4,   faces: 4,  efeito: "PYRO.Elementos.Efeito.agua" },
  gelo:   { label: "PYRO.Elementos.gelo",   grupo: "aguaGelo",   tipoDano: "frio",    base: 4, porIntencao: 2,   faces: 8,  efeito: "PYRO.Elementos.Efeito.gelo" },
  vento:  { label: "PYRO.Elementos.vento",  grupo: "arVento",    tipoDano: "impacto", base: 4, porIntencao: 4,   faces: 4,  efeito: "PYRO.Elementos.Efeito.vento" },
  terra:  { label: "PYRO.Elementos.terra",  grupo: "pedraTerra", tipoDano: "impacto", base: 3, porIntencao: 2,   faces: 12, efeito: "PYRO.Elementos.Efeito.terra" },
  raio:   { label: "PYRO.Elementos.raio",   grupo: "raio",       tipoDano: "energia", base: 2, porIntencao: 0.5, faces: 10, efeito: "PYRO.Elementos.Efeito.raio",
            extras: [{ nome: "PYRO.Scaling.Corrente", base: 0.5, porIntencao: 0.5, faces: 0 }] },
  vida:   { label: "PYRO.Elementos.vida",   grupo: "vida",       tipoDano: "cura",    base: 4, porIntencao: 4,   faces: 8,  efeito: "PYRO.Elementos.Efeito.vida" },
  mente:  { label: "PYRO.Elementos.mente",  grupo: "mente",      tipoDano: "mental",  base: 1, porIntencao: 1,   faces: 6,  efeito: "PYRO.Elementos.Efeito.mente" },
  morte:  { label: "PYRO.Elementos.morte",  grupo: "morte",      tipoDano: "indefinido", base: 2, porIntencao: 2, faces: 12, efeito: "PYRO.Elementos.Efeito.morte", subjulgar: true },
  espaco: { label: "PYRO.Elementos.espaco", grupo: "espaco",     tipoDano: "",        base: 0, porIntencao: 0,   faces: 0,  efeito: "PYRO.Elementos.Efeito.espaco" }
};

PYRO.elementos = foundry.utils.deepClone(PYRO.elementosPadrao);

/** Nº de dados de um elemento na Intenção N. */
PYRO.dadosElemento = (cfg, N) => ({
  n: Math.max(0, Math.floor(cfg.base + cfg.porIntencao * (N - 1))),
  faces: cfg.faces
});

/**
 * Línguas rúnicas e potenciais mágicos — a mesma escala.
 * fator: peso na escala de mana. Custo de uma runa é relativo:
 *   custo = base x (fator da língua / fator mágico do conjurador).
 * efeito: multiplica os valores por Intenção (nº de dados).
 * povo: rótulo usado no campo "Potencial mágico" dos caminhos.
 */
PYRO.linguasPadrao = {
  humana:    { label: "PYRO.Linguas.humana",    povo: "PYRO.Povos.humana",    fator: 1, efeito: 1 },
  elfica:    { label: "PYRO.Linguas.elfica",    povo: "PYRO.Povos.elfica",    fator: 2, efeito: 2.5 },
  draconica: { label: "PYRO.Linguas.draconica", povo: "PYRO.Povos.draconica", fator: 4, efeito: 10 },
  angelical: { label: "PYRO.Linguas.angelical", povo: "PYRO.Povos.angelical", fator: 5, efeito: 25 }
};

PYRO.linguas = foundry.utils.deepClone(PYRO.linguasPadrao);

/**
 * Afinidades: derivadas dos elementos pelo campo grupo. Um grupo com mais de
 * um elemento vira uma afinidade só (Água/Gelo libera as duas runas).
 * "outro" é texto livre pra elementos customizados da mesa.
 */
PYRO.construirAfinidades = () => {
  const grupos = {};
  for (const [chave, cfg] of Object.entries(PYRO.elementos)) {
    const g = cfg.grupo || chave;
    grupos[g] ??= { rotulos: [], elementos: [] };
    grupos[g].rotulos.push(game.i18n.localize(cfg.label));
    grupos[g].elementos.push(chave);
  }
  const out = {};
  for (const [g, dados] of Object.entries(grupos)) {
    out[g] = { label: dados.rotulos.join("/"), elementos: dados.elementos };
  }
  out.outro = { label: game.i18n.localize("PYRO.Afinidade.outro"), elementos: [] };
  PYRO.afinidades = out;
  return out;
};

PYRO.afinidades = {};

/** Texto da Forma na Intenção N (gestos reconhecidos pelo nome). */
PYRO.formas = {
  projetil: { label: "PYRO.Formas.projetil", desc: N => ({ key: "PYRO.Formas.Desc.projetil", data: { alcance: 6 + 4 * (N - 1) } }) },
  explosao: { label: "PYRO.Formas.explosao", desc: N => ({ key: "PYRO.Formas.Desc.explosao", data: { raio: N } }) },
  cone:     { label: "PYRO.Formas.cone",     desc: N => ({ key: "PYRO.Formas.Desc.cone",     data: { alcance: 3 + 2 * (N - 1) } }) },
  linha:    { label: "PYRO.Formas.linha",    desc: N => ({ key: "PYRO.Formas.Desc.linha",    data: { alcance: 6 + 4 * (N - 1) } }) },
  muro:     { label: "PYRO.Formas.muro",     desc: N => ({ key: "PYRO.Formas.Desc.muro",     data: { ext: 3 + 2 * (N - 1), pv: 5 * N } }) },
  aura:     { label: "PYRO.Formas.aura",     desc: N => ({ key: "PYRO.Formas.Desc.aura",     data: { rodadas: N } }) },
  toque:    { label: "PYRO.Formas.toque",    desc: N => ({ key: "PYRO.Formas.Desc.toque",    data: { bonus: N } }) }
};

PYRO.modificadores = {
  amplo:       "PYRO.Modificadores.amplo",
  longo:       "PYRO.Modificadores.longo",
  persistente: "PYRO.Modificadores.persistente",
  preciso:     "PYRO.Modificadores.preciso",
  dividir:     "PYRO.Modificadores.dividir"
};

PYRO.tiposRuna = {
  elemento:    "PYRO.Runas.elemento",
  forma:       "PYRO.Runas.forma",
  modificador: "PYRO.Runas.modificador"
};

/** Custo de mana de uma Intenção N: soma triangular N(N+1)/2. */
PYRO.custoIntencao = N => (N * (N + 1)) / 2;

/* -------------------------------------------------------------------------- */
/*  Caminhos e raças                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Recursos personalizados de raça/classe, além de PV, Estamina, Mana,
 * Energia e Vontade. Máximo = (base + atributo x porPonto) +10% por patamar.
 * recAtributo/recPorPonto definem a recuperação por cena (vazio = não recupera).
 * AJUSTE: a Energia Natural do elfo não-mago entrou com SAB x 5, espelhando a
 * mana; ajuste na tela de configurações se a conjuração natural escalar diferente.
 */
PYRO.recursosCustomPadrao = {
  energiaNatural: {
    label: "PYRO.Recursos.energiaNatural",
    atributo: "sab", porPonto: 5, base: 0,
    recAtributo: "int", recPorPonto: 1
  }
};

PYRO.recursosCustom = foundry.utils.deepClone(PYRO.recursosCustomPadrao);

/**
 * Raças pré-definidas (editáveis nas configurações do mundo).
 * label: texto do dropdown.  nome: padrão do nome automático do caminho,
 * com {detalhe} opcional.  custom: raça aberta, em que o jogador decide
 * se usa magia/feitiçaria (nas demais, o preset manda e as checkboxes somem).
 */
PYRO.racasPadrao = {
  // Humano é uma entrada só: magia e feitiçaria ficam nas checkboxes.
  humano:           { label: "PYRO.Racas.humano",           nome: "PYRO.Racas.Nome.humano",           potencial: "humana", magia: false, feiticos: false, detalhe: false, custom: true },
  elfo:             { label: "PYRO.Racas.elfo",             nome: "PYRO.Racas.Nome.elfo",             potencial: "elfica", magia: true,  feiticos: false, detalhe: true,  custom: false, recursos: ["energiaNatural"] },
  demiHumano:       { label: "PYRO.Racas.demiHumano",       nome: "PYRO.Racas.Nome.demiHumano",       potencial: "humana", magia: false, feiticos: false, detalhe: true,  custom: true },
  outro:            { label: "PYRO.Racas.outro",            nome: "PYRO.Racas.Nome.outro",            potencial: "humana", magia: false, feiticos: false, detalhe: true,  custom: true }
};

PYRO.racas = foundry.utils.deepClone(PYRO.racasPadrao);

/* -------------------------------------------------------------------------- */
/*  Progressão de XP                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Curva padrão de custo das habilidades: cada vaga da fila custa uma unidade
 * a mais que a anterior (1, 2, 3, 4...).
 */
PYRO.progressaoPadrao = { chave: "", label: "", passo: 1, multiplicador: 1 };

/**
 * Regras que trocam a curva de um Caminho inteiro. Uma regra é disparada por
 * nome: se o Caminho tem uma habilidade chamada como um dos `nomes`, ele passa
 * a usar aquele passo e multiplicador. É por isso que a criação de habilidade
 * não ganhou campo nenhum — quem define o comportamento é o nome que o jogador
 * escreveu, e a lista mora aqui, com o mestre.
 *
 *   custo da vaga N = multiplicador x teto(N / passo)
 *
 * passo 2 e multiplicador 1 dá 1, 1, 2, 2, 3, 3. passo 1 e multiplicador 2 dá
 * 2, 4, 6. Um passo altíssimo deixa o caminho inteiro a preço fixo.
 *
 * Nasce vazia: a mesa cria as regras que quiser em Configurações > Sistema.
 */
PYRO.progressoesPadrao = {};

PYRO.progressoes = foundry.utils.deepClone(PYRO.progressoesPadrao);

/** Nome de habilidade normalizado: sem acento, sem caixa, sem espaço sobrando. */
PYRO.normalizarNome = texto => String(texto ?? "")
  .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\s+/g, " ").trim();

/**
 * Índice nome -> regra, remontado sempre que as configurações são aplicadas.
 * Sem ele, cada habilidade preparada teria que reprocessar a lista inteira.
 * A ordem da lista é a prioridade: o primeiro dono de um nome fica com ele.
 */
PYRO.indexarProgressoes = () => {
  const indice = new Map();
  let posicao = 0;
  for (const [chave, regra] of Object.entries(PYRO.progressoes ?? {})) {
    for (const nome of String(regra.nomes ?? "").split(",")) {
      const limpo = PYRO.normalizarNome(nome);
      if (!limpo || indice.has(limpo)) continue;
      indice.set(limpo, {
        chave,
        // Posição na lista: é o desempate quando o Caminho tem habilidades
        // que disparam mais de uma regra. A ordem dos itens na ficha seria
        // arbitrária demais para servir de critério.
        posicao,
        label: regra.label || chave,
        passo: Math.max(1, Math.round(regra.passo ?? 1)),
        multiplicador: Number(regra.multiplicador ?? 1)
      });
    }
    posicao += 1;
  }
  PYRO.progressaoPorNome = indice;
  return indice;
};

PYRO.progressaoPorNome = new Map();

/** Como a habilidade se comporta na ficha. */
PYRO.categoriasHabilidade = {
  pericia: "PYRO.Item.Cat.pericia",
  passiva: "PYRO.Item.Cat.passiva",
  ativavel: "PYRO.Item.Cat.ativavel"
};

/** Habilidades gastam ações ou reações. */
PYRO.tiposCusto = {
  acao: "PYRO.Item.Acao",
  reacao: "PYRO.Item.Reacao"
};

/** Multiplicador de Subjulgar por diferença de DET (usuário - alvo). */
PYRO.multiplicadorSubjulgar = dif => {
  if (dif <= -2) return 0;
  if (dif === -1) return 0.25;
  if (dif === 0) return 0.5;
  if (dif === 1) return 1;
  if (dif === 2) return 2.5;
  if (dif === 3) return 5;
  return 10;
};

/**
 * Linhas da tabela de Subjulgar, do alvo mais forte pro mais fraco.
 * dif = DET do conjurador - DET do alvo. As pontas são faixas ("≥" e "≤").
 */
PYRO.faixasSubjulgar = [
  { dif: -2, faixa: "acima" },
  { dif: -1 }, { dif: 0 }, { dif: 1 }, { dif: 2 }, { dif: 3 },
  { dif: 4, faixa: "abaixo" }
];

/**
 * Condições do sistema (SRD §11; Desmaiado vem de Subjulgar). Registradas em
 * CONFIG.statusEffects no init: aparecem no HUD do token e o construtor de
 * efeitos as aplica via statuses. O comportamento mecânico de cada uma ainda
 * não existe — por ora são marcadores visíveis no token e na ficha.
 */
PYRO.condicoes = {
  queimando: { label: "PYRO.Condicoes.queimando", img: "icons/svg/fire.svg" },
  friagem:   { label: "PYRO.Condicoes.friagem",   img: "icons/svg/frozen.svg" },
  irritado:  { label: "PYRO.Condicoes.irritado",  img: "icons/svg/combat.svg" },
  inseguro:  { label: "PYRO.Condicoes.inseguro",  img: "icons/svg/downgrade.svg" },
  apavorado: { label: "PYRO.Condicoes.apavorado", img: "icons/svg/terror.svg" },
  culpado:   { label: "PYRO.Condicoes.culpado",   img: "icons/svg/degen.svg" },
  insensato: { label: "PYRO.Condicoes.insensato", img: "icons/svg/daze.svg" },
  desmaiado: { label: "PYRO.Condicoes.desmaiado", img: "icons/svg/unconscious.svg" }
};

/**
 * Alvos disponíveis no construtor de efeitos, por categoria.
 * Só campos base: Active Effects são aplicados antes de prepareDerivedData,
 * então mexer em derivados (PV máximo, velocidade, pool) não gruda — o jeito
 * é alterar o atributo ou o bônus correspondente.
 */
PYRO.alvosEfeito = {
  atributos: {
    label: "PYRO.Efeitos.Cat.atributos",
    // O alvo é o bônus, não o valor digitado: o efeito vira +X ao lado da
    // base na ficha, em vez de sobrescrever o número do jogador.
    alvos: Object.fromEntries(Object.entries(PYRO.atributos)
      .map(([k, label]) => [`system.atributos.${k}.bonus`, label]))
  },
  recursos: {
    label: "PYRO.Efeitos.Cat.recursos",
    alvos: {
      "system.recursos.pv.bonus": "PYRO.Efeitos.Alvo.pvBonus",
      "system.recursos.estamina.bonus": "PYRO.Efeitos.Alvo.estaminaBonus",
      "system.recursos.mana.bonus": "PYRO.Efeitos.Alvo.manaBonus",
      "system.recursos.energia.bonus": "PYRO.Efeitos.Alvo.energiaBonus",
      "system.recursos.vontade.bonus": "PYRO.Efeitos.Alvo.vontadeBonus"
    }
  },
  defesasCategoria: {
    label: "PYRO.Efeitos.Cat.defesasCategoria",
    alvos: Object.fromEntries(Object.entries(PYRO.categoriasDano)
      .map(([k, label]) => [`system.defesas.categorias.${k}`, label]))
  },
  defesasTipo: {
    label: "PYRO.Efeitos.Cat.defesasTipo",
    alvos: Object.fromEntries(Object.entries(PYRO.tiposDano)
      .map(([k, cfg]) => [`system.defesas.tipos.${k}`, cfg.label]))
  },
  condicao: {
    label: "PYRO.Efeitos.Cat.condicao",
    alvos: Object.fromEntries(Object.entries(PYRO.condicoes)
      .map(([k, cfg]) => [k, cfg.label]))
  },
  movimento: {
    label: "PYRO.Efeitos.Cat.movimento",
    alvos: {
      "system.velocidadeBonus": "PYRO.Efeitos.Alvo.velocidadeBonus",
      "system.velocidadeMult": "PYRO.Efeitos.Alvo.velocidadeMult"
    }
  },
  outros: {
    label: "PYRO.Efeitos.Cat.outros",
    alvos: {
      "system.det": "PYRO.DET",
      "system.dinheiro": "PYRO.Dinheiro",
      "system.tamanhoMod": "PYRO.Efeitos.Alvos.tamanhoMod",
      "system.tamanho": "PYRO.Efeitos.Alvos.tamanho",
      "system.maos": "PYRO.Efeitos.Alvos.maos"
    }
  }
};

/** Modos de aplicação (espelham CONST.ACTIVE_EFFECT_MODES). */
PYRO.modosEfeito = {
  2: "PYRO.Efeitos.Modo.somar",
  1: "PYRO.Efeitos.Modo.multiplicar",
  5: "PYRO.Efeitos.Modo.substituir",
  4: "PYRO.Efeitos.Modo.minimo",
  3: "PYRO.Efeitos.Modo.maximo"
};

/** Guia rápido de ações (SRD §5). */
PYRO.guiaAcoes = [
  "atacar", "mirar", "mover", "sacarArma", "tomarAr", "salto", "agarrar",
  "escalar", "furtividade", "bloquear", "esquivar", "cobertura",
  "atrasar", "ajudar", "foraDoTurno"
];
