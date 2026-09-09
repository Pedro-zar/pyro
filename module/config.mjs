/**
 * Dados de configuração do PYRO. Tudo que é tabela de regras vive aqui.
 * Línguas/potenciais e elementos podem ser editados pelo mestre nas
 * configurações do mundo (ver settings.mjs) — por isso são dados puros,
 * sem funções, e reconstruídos no init.
 */
import { caminho } from "./sistema.mjs";

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

/**
 * Teto de atributo por Determinação (SRD Atributos). O SRD lista 15, 15, 20,
 * 30, 45, 65, 90 e 120 até a DET 7, e a regra por trás é "cada degrau soma
 * 5 × (DET − 1) ao anterior" — é ela que está aqui, e não a lista, para uma
 * campanha que passe da DET 7 continuar tendo teto.
 *
 * DET 0 e DET 1 param no mesmo 15: o primeiro degrau soma 5 × 0.
 */
PYRO.tetoDeAtributo = det => {
  const alvo = Math.max(0, Math.round(Number(det) || 0));
  let teto = 15;
  for (let d = 1; d <= alvo; d++) teto += 5 * (d - 1);
  return teto;
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

/**
 * Dados base das reações (SRD §5). As faces são do sistema, não da ficha:
 * bloquear é sempre d4 e esquivar sempre d12, e o que muda de personagem para
 * personagem é a quantidade — o que equipamento e efeito somam.
 */
PYRO.reacoes = {
  bloqueio: { dados: 2, faces: 4 },
  esquiva:  { dados: 2, faces: 12 }
};

/* -------------------------------------------------------------------------- */
/*  Tamanho e carga                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Tamanhos (SRD). Cada linha carrega tudo que o tamanho decide:
 *
 *   token       lado do token em espaços do grid (o mapa usa 1m por espaço).
 *   dadosArma   multiplicador dos dados da arma. Está aqui só como referência:
 *               o sistema não aplica sozinho, quem aplica é quem monta a arma.
 *   alcance     até onde a criatura alcança, em metros, medido do centro do
 *               token. É a base da mira — o dobro disso não pede teste.
 *   vidaPorVig  PV por ponto de VIG.
 *   multCarga   capacidade de carga = FOR x mult.
 *   exato       [mínimo, máximo] de espaços quando o tamanho não é fechado.
 *               Massivo e colossal pedem esse número na raça; máximo null é
 *               ponta aberta. Nos outros tamanhos o campo não existe.
 *
 * Pequeno e Médio têm os mesmos números de propósito: a diferença entre eles
 * é de descrição, não de regra.
 */
PYRO.tamanhos = {
  minusculo: { label: "PYRO.Tamanhos.minusculo", token: 0.25, dadosArma: 0.25, alcance: 0,  vidaPorVig: 4,  multCarga: 0.5 },
  pequenino: { label: "PYRO.Tamanhos.pequenino", token: 0.5,  dadosArma: 0.5,  alcance: 1,  vidaPorVig: 5,  multCarga: 1 },
  pequeno:   { label: "PYRO.Tamanhos.pequeno",   token: 1,    dadosArma: 1,    alcance: 1,  vidaPorVig: 7,  multCarga: 2 },
  medio:     { label: "PYRO.Tamanhos.medio",     token: 1,    dadosArma: 1,    alcance: 1,  vidaPorVig: 7,  multCarga: 2 },
  grande:    { label: "PYRO.Tamanhos.grande",    token: 2,    dadosArma: 2,    alcance: 2,  vidaPorVig: 10, multCarga: 4 },
  gigante:   { label: "PYRO.Tamanhos.gigante",   token: 4,    dadosArma: 4,    alcance: 4,  vidaPorVig: 14, multCarga: 8 },
  massivo:   { label: "PYRO.Tamanhos.massivo",   token: 8,    dadosArma: 8,    alcance: 8,  vidaPorVig: 20, multCarga: 16, exato: [8, 15] },
  colossal:  { label: "PYRO.Tamanhos.colossal",  token: 16,   dadosArma: 16,   alcance: 16, vidaPorVig: 28, multCarga: 32, exato: [16, null] }
};

/** O tamanho pede um número exato de espaços? Massivo e colossal pedem. */
PYRO.pedeTamanhoExato = tamanho => !!PYRO.tamanhos[tamanho]?.exato;

/** Encaixa o número exato nos limites do tamanho (massivo 8–15, colossal 16+). */
PYRO.tamanhoExatoNaFaixa = (tamanho, valor) => {
  const faixa = PYRO.tamanhos[tamanho]?.exato;
  if (!faixa) return 0;
  const [min, max] = faixa;
  const n = Math.round(Number(valor)) || min;
  return max === null ? Math.max(min, n) : Math.min(max, Math.max(min, n));
};

/**
 * Espaços que a criatura ocupa no grid. Massivo e colossal usam o número
 * exato da raça quando ela tem um; sem número, vale o mínimo do degrau.
 */
PYRO.escalaTamanho = (tamanho, exato = 0) => {
  const cfg = PYRO.tamanhos[tamanho];
  if (!cfg) return 1;
  return cfg.exato && exato ? PYRO.tamanhoExatoNaFaixa(tamanho, exato) : cfg.token;
};

/**
 * Alcance da criatura em metros. Do Grande para cima o alcance é o próprio
 * espaço ocupado, então um colossal de 24 espaços alcança 24m — a tabela
 * fecha assim, e o número exato continua valendo aqui.
 */
PYRO.alcanceTamanho = (tamanho, exato = 0) => {
  const cfg = PYRO.tamanhos[tamanho];
  if (!cfg) return 1;
  return cfg.exato && exato ? PYRO.tamanhoExatoNaFaixa(tamanho, exato) : cfg.alcance;
};

/**
 * Até onde a criatura ataca sem teste de mira: o dobro do alcance dela. Um
 * Médio (1m) acerta de graça a 1m e 2m e testa de 3m em diante; um Grande
 * (2m) vai até 4m.
 */
PYRO.miraLivre = (tamanho, exato = 0) => 2 * PYRO.alcanceTamanho(tamanho, exato);

/**
 * Quanto o PV precisa acompanhar quando o tamanho muda. Vida por VIG é o
 * único número da tabela que mexe num recurso, então trocar de médio (7) para
 * enorme (14) dobra o PV atual junto com o máximo: quem estava com 3 de 7
 * fica com 6 de 14, e não com 3 de 14.
 */
PYRO.razaoVida = (de, para) => {
  const antes = PYRO.tamanhos[de]?.vidaPorVig;
  const depois = PYRO.tamanhos[para]?.vidaPorVig;
  if (!antes || !depois) return 1;
  return depois / antes;
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
/*  Categorias de item                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Sabores de equipamento. Todos compartilham parte do corpo, defesas e peso;
 * o que muda é o que cada um faz além disso — mochila carrega mais, item
 * arcano barateia mana.
 */
PYRO.categoriasEquipamento = {
  equipamento: "PYRO.CatItem.equipamento",
  artefato:    "PYRO.CatItem.artefato",
  arcano:      "PYRO.CatItem.arcano",
  mochila:     "PYRO.CatItem.mochila"
};

/**
 * Baldes do inventário, na ordem em que aparecem na ficha.
 *
 * Cada balde sabe filtrar o que lhe pertence e criar um item novo já
 * classificado, então a aba, o botão de criar e as pastas do compêndio saem
 * todos daqui. Munição e consumível são o mesmo tipo de item separados por uma
 * marcação; artefato, arcano e mochila são equipamento com categoria própria.
 */
PYRO.categoriasItem = {
  equipamento: { rotulo: "PYRO.CatItem.equipamento", secao: "PYRO.Secao.equipamentos", tipo: "equipamento", categoria: "equipamento" },
  arma:        { rotulo: "PYRO.CatItem.arma",        secao: "PYRO.Secao.armas",        tipo: "arma" },
  municao:     { rotulo: "PYRO.CatItem.municao",     secao: "PYRO.Secao.municoes",     tipo: "consumivel", municao: true },
  artefato:    { rotulo: "PYRO.CatItem.artefato",    secao: "PYRO.Secao.artefatos",    tipo: "equipamento", categoria: "artefato" },
  arcano:      { rotulo: "PYRO.CatItem.arcano",      secao: "PYRO.Secao.arcanos",      tipo: "equipamento", categoria: "arcano" },
  mochila:     { rotulo: "PYRO.CatItem.mochila",     secao: "PYRO.Secao.mochilas",     tipo: "equipamento", categoria: "mochila" },
  consumivel:  { rotulo: "PYRO.CatItem.consumivel",  secao: "PYRO.Secao.consumiveis",  tipo: "consumivel", municao: false }
};

/** O item cai neste balde do inventário? */
PYRO.itemNaCategoria = (item, chave) => {
  const cfg = PYRO.categoriasItem[chave];
  if (!cfg || item.type !== cfg.tipo) return false;
  if (cfg.municao !== undefined) return !!item.system.municao === cfg.municao;
  if (cfg.categoria !== undefined) return item.system.categoria === cfg.categoria;
  return true;
};

/* -------------------------------------------------------------------------- */
/*  Magia                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Elementos. Os dados de dano seguem a mesma fórmula dos escalonamentos:
 *   nº de dados = base + floor(porIntencao x (Intenção - 1))
 * Conferindo com a tabela do SRD: fogo 3N d6 (3/3), água e vento 4N d4 (4/4),
 * gelo (2N+2) d8 (4/2), terra (2N+1) d12 (3/2), raio 2+floor((N-1)/2) d10
 * (2/0.5), vida (2N+2) d8 (4/2), mente N d6 (1/1), morte 2N d12 (2/2).
 * faces 0 = elemento sem dano padrão (Espaço).
 * grupo = afinidade que libera este elemento (Água e Gelo compartilham).
 */
PYRO.elementosPadrao = {
  fogo:   { label: "PYRO.Elementos.fogo",   grupo: "fogo",       tipoDano: "calor",   base: 3, porIntencao: 3,   faces: 6,  efeito: "PYRO.Elementos.Efeito.fogo" },
  agua:   { label: "PYRO.Elementos.agua",   grupo: "aguaGelo",   tipoDano: "impacto", base: 4, porIntencao: 4,   faces: 4,  efeito: "PYRO.Elementos.Efeito.agua",
            extras: [{ nome: "PYRO.Scaling.Molhado", base: 1, porIntencao: 1, faces: 0 }] },
  gelo:   { label: "PYRO.Elementos.gelo",   grupo: "aguaGelo",   tipoDano: "frio",    base: 4, porIntencao: 2,   faces: 8,  efeito: "PYRO.Elementos.Efeito.gelo",
            extras: [{ nome: "PYRO.Scaling.Friagem", base: 1, porIntencao: 1, faces: 0 }] },
  vento:  { label: "PYRO.Elementos.vento",  grupo: "arVento",    tipoDano: "impacto", base: 4, porIntencao: 4,   faces: 4,  efeito: "PYRO.Elementos.Efeito.vento",
            extras: [{ nome: "PYRO.Scaling.Empurrado", base: 1, porIntencao: 1, faces: 0 }] },
  terra:  { label: "PYRO.Elementos.terra",  grupo: "pedraTerra", tipoDano: "impacto", base: 3, porIntencao: 2,   faces: 12, efeito: "PYRO.Elementos.Efeito.terra",
            extras: [{ nome: "PYRO.Scaling.DefesaFisica", base: 1, porIntencao: 1, faces: 0 }] },
  raio:   { label: "PYRO.Elementos.raio",   grupo: "raio",       tipoDano: "energia", base: 2, porIntencao: 0.5, faces: 10, efeito: "PYRO.Elementos.Efeito.raio",
            extras: [{ nome: "PYRO.Scaling.Corrente", base: 0.5, porIntencao: 0.5, faces: 0 }] },
  vida:   { label: "PYRO.Elementos.vida",   grupo: "vida",       tipoDano: "cura",    base: 2, porIntencao: 2,   faces: 8,  efeito: "PYRO.Elementos.Efeito.vida" },
  mente:  { label: "PYRO.Elementos.mente",  grupo: "mente",      tipoDano: "mental",  base: 1, porIntencao: 1,   faces: 6,  efeito: "PYRO.Elementos.Efeito.mente",
            extras: [{ nome: "PYRO.Scaling.CondicoesMentais", base: 1, porIntencao: 1, faces: 0 }] },
  morte:  { label: "PYRO.Elementos.morte",  grupo: "morte",      tipoDano: "indefinido", base: 2, porIntencao: 2, faces: 12, efeito: "PYRO.Elementos.Efeito.morte", subjulgar: true },
  espaco: { label: "PYRO.Elementos.espaco", grupo: "espaco",     tipoDano: "",        base: 0, porIntencao: 0,   faces: 0,  efeito: "PYRO.Elementos.Efeito.espaco" }
};

PYRO.elementos = foundry.utils.deepClone(PYRO.elementosPadrao);

/**
 * Línguas rúnicas e potenciais mágicos — a mesma escala.
 * fator: peso na escala de mana. Custo de uma runa é relativo:
 *   custo = base x (fator da língua / fator mágico do conjurador).
 * efeito: multiplica os valores por Intenção (nº de dados).
 * povo: rótulo usado no campo "Potencial mágico" dos caminhos.
 */
PYRO.linguasPadrao = {
  humana:    { label: "PYRO.Linguas.humana",    povo: "PYRO.Povos.humana",    fator: 1, efeito: 1 },
  elfica:    { label: "PYRO.Linguas.elfica",    povo: "PYRO.Povos.elfica",    fator: 2, efeito: 2 },
  draconica: { label: "PYRO.Linguas.draconica", povo: "PYRO.Povos.draconica", fator: 4, efeito: 4 },
  angelical: { label: "PYRO.Linguas.angelical", povo: "PYRO.Povos.angelical", fator: 5, efeito: 5 }
};

PYRO.linguas = foundry.utils.deepClone(PYRO.linguasPadrao);

/**
 * Sobe (ou desce) um potencial na escada das línguas, na ordem em que estão
 * configuradas: humana → élfica → dracônica → angelical. É o degrau que o
 * efeito "potencial mágico" percorre — um Milagre com +1 faz o humano conjurar
 * como um elfo, sem trocar de raça. Passos além das pontas param nelas, e
 * língua fora da tabela fica onde está.
 */
PYRO.subirPotencial = (chave, passos) => {
  const n = Math.round(Number(passos) || 0);
  if (!n) return chave;
  const ordem = Object.keys(PYRO.linguas);
  const i = ordem.indexOf(chave);
  if (i < 0) return chave;
  return ordem[Math.clamp(i + n, 0, ordem.length - 1)];
};

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

/**
 * Gestos nomeados pelo SRD (Tabela de Formas e de Gestos Modificadores). Os
 * números de cada um vivem na runa do compêndio; estas tabelas existem para o
 * sistema reconhecer o gesto pelo nome que a mesa escreveu. Só três mudam o
 * comportamento da conjuração (ver GESTOS_COM_REGRA em magia.mjs): Toque
 * empresta Intenção, Longo sobe passos de alcance e Dividir reparte o dano.
 */
PYRO.formas = {
  projetil: { label: "PYRO.Formas.projetil" },
  explosao: { label: "PYRO.Formas.explosao" },
  cone:     { label: "PYRO.Formas.cone" },
  linha:    { label: "PYRO.Formas.linha" },
  muro:     { label: "PYRO.Formas.muro" },
  aura:     { label: "PYRO.Formas.aura" },
  toque:    { label: "PYRO.Formas.toque" }
};

PYRO.modificadores = {
  amplo:       { label: "PYRO.Modificadores.amplo" },
  longo:       { label: "PYRO.Modificadores.longo" },
  persistente: { label: "PYRO.Modificadores.persistente" },
  preciso:     { label: "PYRO.Modificadores.preciso" },
  dividir:     { label: "PYRO.Modificadores.dividir" }
};

/** Gestos que o sistema conhece pelo nome, de qualquer um dos dois tipos. */
PYRO.gestosNomeados = () => ({ ...PYRO.formas, ...PYRO.modificadores });

/**
 * Passos de alcance (SRD Atributos): toque, estendido, curto, médio, longo,
 * distante e os degraus sem nome. É a escada que o gesto Longo percorre.
 */
PYRO.passosDeAlcance = [1, 3, 6, 20, 60, 200, 500, 1500, 3000, 5000, 10000];

/**
 * Sobe um alcance em metros pela escada dos passos. O degrau de partida é o
 * maior que ainda cabe no alcance atual, então um projétil de 10m parte do
 * curto (6m) e um passo o leva ao médio (20m).
 */
PYRO.subirAlcance = (metros, passos) => {
  const n = Math.round(Number(passos) || 0);
  if (n <= 0) return metros;
  const escada = PYRO.passosDeAlcance;
  let i = 0;
  while (i + 1 < escada.length && escada[i + 1] <= metros) i++;
  return escada[Math.min(escada.length - 1, i + n)];
};

/**
 * Intenções que o card entrega em um clique.
 *
 * A chave é o escalonamento (ver chaveVariavel em magia.mjs), e não a runa:
 * qualquer runa que tenha uma Intenção chamada "Molhado" molha o alvo, seja
 * ela do compêndio ou escrita pelo mestre numa runa nova. É o que faz a regra
 * ser da Intenção, e não do elemento.
 *
 *   regra          o que o clique faz (ver aplicarRegraElemental em chat.mjs).
 *   noConjurador   o efeito volta para quem conjurou, e não para o alvo.
 *
 * Intenção que não está aqui vira número no card e a mesa resolve o resto —
 * é o caso do Empurrado do vento e da Corrente do raio.
 */
PYRO.regrasDeIntencao = {
  molhado: { regra: "molhado" },
  friagem: { regra: "friagem" },
  // A terra defende quem a ergueu, e não quem estiver selecionado no clique.
  defesaFisica: { regra: "defesaTerra", noConjurador: true },
  condicoesMentais: { regra: "mental" }
};

/**
 * A única regra que não sai de uma Intenção: o Queimando do fogo conta os 6
 * rolados no dano, e por isso continua presa ao elemento.
 */
PYRO.regraDosSeis = { fogo: { regra: "queimando" } };

/**
 * Ícone padrão de cada tipo de item, do conjunto do sistema (ver icons/).
 *
 * O Foundry dá a mesma sacola a tudo que nasce, e uma lista de vinte itens com
 * o mesmo desenho não diz nada.
 */
PYRO.iconePorTipo = {
  arma: "arma", equipamento: "equipamento", consumivel: "consumivel",
  habilidade: "habilidade", tecnica: "tecnica", pericia: "pericia",
  magia: "magia", runa: "runa", caminho: "caminho", feitico: "feitico"
};

/**
 * Caminho de um ícone do sistema, pelo nome do arquivo sem extensão. Passa por
 * caminho() porque o Foundry resolve imagem a partir da raiz de dados, e o id
 * do sistema muda entre a mesa e a cópia de desenvolvimento.
 */
PYRO.icone = nome => caminho(`icons/${nome}.svg`);

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
 * A Energia Natural ainda não tem regra no SRD; SAB x 5 espelha a mana até lá.
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
  humano:           { label: "PYRO.Racas.humano",           nome: "PYRO.Racas.Nome.humano",           potencial: "humana", magia: false, feiticos: false, detalhe: false, custom: true,  tamanhoMin: "pequeno",   tamanhoMax: "medio" },
  elfo:             { label: "PYRO.Racas.elfo",             nome: "PYRO.Racas.Nome.elfo",             potencial: "elfica", magia: true,  feiticos: false, detalhe: true,  custom: false, tamanhoMin: "medio",     tamanhoMax: "medio", recursos: ["energiaNatural"] },
  demiHumano:       { label: "PYRO.Racas.demiHumano",       nome: "PYRO.Racas.Nome.demiHumano",       potencial: "humana", magia: false, feiticos: false, detalhe: true,  custom: true,  tamanhoMin: "pequeno",   tamanhoMax: "grande" },
  outro:            { label: "PYRO.Racas.outro",            nome: "PYRO.Racas.Nome.outro",            potencial: "humana", magia: false, feiticos: false, detalhe: true,  custom: true,  tamanhoMin: "minusculo", tamanhoMax: "colossal" }
};

PYRO.racas = foundry.utils.deepClone(PYRO.racasPadrao);

/**
 * Nome de uma raça com o {detalhe} preenchido: elfo + "Corvo" => "Elfo (Corvo)".
 * A troca é feita à mão porque o padrão nem sempre é chave de tradução: a
 * configuração de raças do mundo salva o texto já resolvido, e
 * game.i18n.format só interpola chaves registradas no catálogo — num padrão
 * literal o "{detalhe}" ficaria por preencher. Detalhe vazio também não deixa
 * um "Elfo ()" para trás.
 */
PYRO.nomeDaRaca = (raca, detalhe) => {
  const preset = PYRO.racas?.[raca];
  if (!preset) return "";
  const modelo = game.i18n.localize(preset.nome ?? preset.label ?? "");
  return modelo
    .replace(/\{detalhe\}/g, (detalhe ?? "").trim())
    .replace(/\(\s*\)/g, "")
    .trim();
};

/**
 * Tamanhos que uma raça aceita, do mínimo ao máximo configurados. É o que
 * alimenta o dropdown na ficha do caminho racial: um humano não aparece com
 * a opção Gigante, então não dá para escolher por engano.
 *
 * Raça fora da tabela (criada pelo mestre sem faixa, ou apagada depois) libera
 * a lista inteira.
 */
PYRO.faixaTamanho = raca => {
  const ordem = Object.keys(PYRO.tamanhos);
  const preset = PYRO.racas?.[raca];
  if (!preset) return ordem;
  let min = ordem.indexOf(preset.tamanhoMin);
  let max = ordem.indexOf(preset.tamanhoMax);
  if (min < 0) min = 0;
  if (max < 0) max = ordem.length - 1;
  // Faixa configurada ao contrário ainda produz algo usável.
  if (min > max) [min, max] = [max, min];
  return ordem.slice(min, max + 1);
};

/**
 * Encaixa um tamanho na faixa da raça, puxando para a borda mais próxima.
 * Trocar um Demi-Humano gigante para Humano vira Médio, e não um valor
 * inválido gravado na ficha.
 */
PYRO.tamanhoNaFaixa = (raca, tamanho) => {
  const faixa = PYRO.faixaTamanho(raca);
  if (faixa.includes(tamanho)) return tamanho;
  const ordem = Object.keys(PYRO.tamanhos);
  const atual = ordem.indexOf(tamanho);
  return atual >= 0 && atual > ordem.indexOf(faixa[faixa.length - 1])
    ? faixa[faixa.length - 1]
    : faixa[0];
};

/* -------------------------------------------------------------------------- */
/*  Nível por uso                                                             */
/* -------------------------------------------------------------------------- */

/** Classes de rolagem contra um ND (SRD 3b). */
PYRO.classesDeRolagem = {
  rotineira: "PYRO.Rolagem.rotineira",
  dificil: "PYRO.Rolagem.dificil",
  muitoDificil: "PYRO.Rolagem.muitoDificil"
};

/**
 * Quanto cada nível exige de rolagens acumuladas para ser alcançado. O índice
 * 0 é o que custa chegar ao nível 1, e assim por diante. `modo` "ou" lê
 * "RR e (RD ou RMD)"; "e" lê "RR e RD e RMD". Perícias e magias/técnicas têm
 * tabelas separadas de propósito: o SRD ainda vai calibrar uma contra a outra.
 */
const linha = (rr, rd, rmd, modo = "ou") => ({ rr, rd, rmd, modo });

PYRO.avancoPorUsoPadrao = {
  // SRD 3b — perícias nascem no nível 0.
  pericia: [
    linha(5, 1, 1), linha(1, 1, 1), linha(2, 1, 1), linha(3, 2, 1), linha(4, 2, 1),
    linha(5, 3, 2), linha(6, 3, 2), linha(7, 4, 2), linha(8, 4, 2), linha(9, 5, 3),
    linha(0, 5, 3, "e"), linha(0, 6, 3, "e"), linha(0, 6, 3, "e"), linha(0, 7, 4, "e"), linha(0, 7, 4, "e"),
    linha(0, 8, 4, "e"), linha(0, 8, 4, "e"), linha(0, 9, 5, "e"), linha(0, 9, 5, "e"), linha(0, 10, 5, "e")
  ],
  // SRD Magia — magias e técnicas nascem no nível 1, então a primeira linha
  // não é consultada; fica para a tabela ter o mesmo formato.
  magiaTecnica: [
    linha(5, 0, 0), linha(2, 1, 1), linha(3, 1, 1), linha(4, 2, 1), linha(5, 2, 1),
    linha(6, 3, 2), linha(7, 3, 2), linha(8, 4, 2), linha(9, 4, 2), linha(10, 5, 3),
    linha(11, 5, 3, "e"), linha(12, 6, 3, "e"), linha(13, 6, 3, "e"), linha(14, 7, 4, "e"), linha(15, 7, 4, "e"),
    linha(16, 8, 4, "e"), linha(17, 8, 4, "e"), linha(18, 9, 5, "e"), linha(19, 9, 5, "e"), linha(20, 10, 5, "e")
  ]
};

PYRO.avancoPorUso = foundry.utils.deepClone(PYRO.avancoPorUsoPadrao);

/* -------------------------------------------------------------------------- */
/*  Progressão de XP                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Curva de custo das habilidades (SRD §3): custoBase x fator^(tier - 1), o que
 * dá 3, 6, 12, 24, 48... A mesa muda os dois em Configurações > Progressão
 * para campanhas mais épicas ou mais aceleradas.
 */
PYRO.curvaXpPadrao = { custoBase: 3, fator: 2 };

PYRO.curvaXp = foundry.utils.deepClone(PYRO.curvaXpPadrao);

/**
 * Custo em XP de um tier, já com o multiplicador do Caminho. Arredonda para
 * cima porque o SRD lista a metade do Humano como 2/3/6/12/24.
 */
PYRO.custoDoTier = (tier, multiplicador = 1, curva = PYRO.curvaXp) => {
  const t = Math.max(1, Math.round(Number(tier) || 1));
  const base = (Number(curva?.custoBase) || 0) * (Number(curva?.fator) || 1) ** (t - 1);
  return Math.max(0, Math.ceil(base * (Number(multiplicador) || 0)));
};

/** Tiers de habilidade (SRD §3), com a descrição de escopo de cada um. */
PYRO.tiers = Object.fromEntries(
  Array.from({ length: 9 }, (_, i) => [i + 1, `PYRO.Tier.${i + 1}`])
);

/**
 * Custo de um Caminho novo (SRD §2): 10 x o número de caminhos que o
 * personagem já tem — o 4º custa 30, o 5º custa 40. Pode ser pago com a
 * Experiência de vários caminhos ao mesmo tempo.
 */
PYRO.custoDoCaminhoNovo = quantos => 10 * Math.max(0, Math.round(Number(quantos) || 0));

/** Caminho sem regra nenhuma paga o custo cheio do tier. */
PYRO.progressaoPadrao = { chave: "", label: "", multiplicador: 1 };

/**
 * Regras que mudam o custo de um Caminho inteiro, disparadas pelo nome de uma
 * habilidade dele: a base "Aprendizado acelerado" do Humano dá multiplicador
 * 0,5. Assim a habilidade do compêndio carrega a regra junto, sem campo novo
 * na ficha. Nasce vazia; a mesa preenche em Configurações > Progressão.
 */
PYRO.progressoesPadrao = {};

PYRO.progressoes = foundry.utils.deepClone(PYRO.progressoesPadrao);

/** Texto comparável: sem acento, sem caixa, sem espaço sobrando. */
PYRO.normalizarTexto = texto => String(texto ?? "")
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
      const limpo = PYRO.normalizarTexto(nome);
      if (!limpo || indice.has(limpo)) continue;
      indice.set(limpo, {
        chave,
        // Posição na lista: é o desempate quando o Caminho tem habilidades
        // que disparam mais de uma regra. A ordem dos itens na ficha seria
        // arbitrária demais para servir de critério.
        posicao,
        label: regra.label || chave,
        multiplicador: Number(regra.multiplicador ?? 1)
      });
    }
    posicao += 1;
  }
  PYRO.progressaoPorNome = indice;
  return indice;
};

PYRO.progressaoPorNome = new Map();

/* -------------------------------------------------------------------------- */
/*  Regras opcionais                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Regras que o SRD marca como opcionais. Cada uma é um interruptor por mundo
 * (Configurações > Regras opcionais); o código pergunta PYRO.regraAtiva(chave).
 */
PYRO.regrasOpcionais = {
  despertar: { label: "PYRO.Regras.despertar.Nome", dica: "PYRO.Regras.despertar.Dica", srd: "SRD §3" },
  det0: { label: "PYRO.Regras.det0.Nome", dica: "PYRO.Regras.det0.Dica", srd: "SRD Atributos" }
};

PYRO.regrasAtivas = {};

PYRO.regraAtiva = chave => !!PYRO.regrasAtivas?.[chave];

/**
 * Recursos que o dano mental pode consumir (SRD §6): ele não tira Vida, e sim
 * "os recursos do alvo". Qual deles é escolha de quem ataca, declarada na arma
 * ou na conjuração — não de quem aplica o dano no chat.
 *
 * Os recursos próprios do mundo (Energia Natural e afins) entram junto, então
 * a lista é montada na hora e não fixada aqui.
 */
PYRO.recursosDrenaveis = () => ({
  mana: "PYRO.Recursos.mana",
  estamina: "PYRO.Recursos.estamina",
  energia: "PYRO.Recursos.energia",
  ...Object.fromEntries(
    Object.entries(PYRO.recursosCustom ?? {}).map(([chave, cfg]) => [chave, cfg.label])
  )
});

/* -------------------------------------------------------------------------- */
/*  Tempo de jogo                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Um turno vale 6 segundos (SRD §1). A rodada não tem tamanho fixo: ela é a
 * soma dos turnos de quem está em cena, então duas pessoas fazem rodadas de
 * 12s e dez pessoas fazem de 60s.
 *
 * É por isso que toda duração do sistema é contada em turnos, e não em
 * rodadas: um minuto são dez turnos na mesa, tenha ela dois ou dez lutadores.
 */
PYRO.SEGUNDOS_POR_TURNO = 6;

/** Turnos que cabem num tempo em segundos: 1 minuto vira 10 turnos. */
PYRO.turnosDeSegundos = segundos =>
  Math.max(1, Math.round((Number(segundos) || 0) / PYRO.SEGUNDOS_POR_TURNO));

/**
 * Unidades em que um prazo pode ser escrito. Turno e segundo são a mesma
 * contagem (um vale seis do outro); a rodada é outra régua, porque ela cresce
 * com a quantidade de gente em cena, e por isso é contada à parte.
 */
PYRO.unidadesDeDuracao = {
  turnos: { label: "PYRO.Duracao.Turnos", curto: "PYRO.Duracao.TurnosCurto" },
  segundos: { label: "PYRO.Duracao.Segundos", curto: "PYRO.Duracao.SegundosCurto" },
  rodadas: { label: "PYRO.Duracao.Rodadas", curto: "PYRO.Duracao.RodadasCurto" }
};

/* -------------------------------------------------------------------------- */
/*  Condições mentais                                                         */
/* -------------------------------------------------------------------------- */

/**
 * As sete condições que o elemento Mente aplica, uma por atributo: cada
 * emoção pesa sobre o que ela atrapalha no corpo ou na cabeça.
 *
 * O `atributo` ainda não faz nada — o quanto cada condição desconta é regra
 * que a mesa não fechou. Ele está aqui porque é a única parte já decidida, e
 * é o que a interface de Mente mostra ao escolher.
 */
PYRO.condicoesMentais = {
  irritado:  { atributo: "des" },
  apavorado: { atributo: "agi" },
  culpado:   { atributo: "vig" },
  inseguro:  { atributo: "pre" },
  insensato: { atributo: "sab" },
  abatido:   { atributo: "for" },
  confuso:   { atributo: "int" }
};

/* -------------------------------------------------------------------------- */
/*  Força de Vontade                                                          */
/* -------------------------------------------------------------------------- */

/** Sorte: re-rola os dados escolhidos de uma rolagem recém feita. */
PYRO.CUSTO_SORTE = 1;
/** Vontade de Viver: a 0 PV, o personagem se agarra à vida e não cai. */
PYRO.CUSTO_VONTADE_DE_VIVER = 2;
/** Inspiração Divina: o atributo daquela rolagem vale o dobro. */
PYRO.CUSTO_INSPIRACAO = 5;

/** Como a habilidade se comporta na ficha. */
/*
 * Postura é uma categoria, e não uma marca à parte: uma habilidade é passiva,
 * ativável ou postura, e as três se excluem. Marcá-la num checkbox separado
 * deixava a ficha aceitar "passiva e postura ao mesmo tempo", que não existe.
 */
PYRO.categoriasHabilidade = {
  passiva: "PYRO.Item.Cat.passiva",
  ativavel: "PYRO.Item.Cat.ativavel",
  postura: "PYRO.Item.Cat.postura"
};

/**
 * A habilidade cobra recurso ao ser usada? Só a ativável.
 *
 * Passiva não é usada, e postura é trocada — quem entra em guarda não paga
 * nada por regra. É a mesma pergunta na ficha do item (o bloco de Custos) e na
 * linha do ator (o resumo de custos), senão a ficha mostraria um custo que
 * ninguém cobra.
 */
PYRO.cobraCustoDeUso = sys => sys?.categoria === "ativavel";

/** Habilidades gastam ações ou reações. */
PYRO.tiposCusto = {
  acao: "PYRO.Item.Acao",
  reacao: "PYRO.Item.Reacao"
};

/* -------------------------------------------------------------------------- */
/*  Técnicas                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Ações base (SRD Técnicas): a ação em que a técnica foi construída, e de onde
 * ela herda os dados e o alcance. O custo em ações não sai daqui — quem dá a
 * base dele é a arma escolhida (ver PYRO.pontosDeAcoes).
 *
 *   ataca      a técnica rola um ataque da ficha (arma ou desarmado).
 *   reacao     é usada fora do próprio turno, e gasta reação em vez de ação.
 */
PYRO.acoesBaseTecnica = {
  atacar:   { label: "PYRO.Tecnica.Base.atacar",   ataca: true },
  agarrar:  { label: "PYRO.Tecnica.Base.agarrar",  ataca: true },
  mover:    { label: "PYRO.Tecnica.Base.mover" },
  saltar:   { label: "PYRO.Tecnica.Base.saltar" },
  bloquear: { label: "PYRO.Tecnica.Base.bloquear", reacao: true },
  esquivar: { label: "PYRO.Tecnica.Base.esquivar", reacao: true }
};

/**
 * Especificidade (SRD Técnicas): condições impostas ao ataque rendem pontos, e
 * a técnica não funciona fora delas. `filtro` diz qual lista de opções a ficha
 * oferece; a especificidade sem filtro ("nenhuma") aceita qualquer ataque, e
 * "ataque" aponta um ataque nomeado da própria ficha.
 */
PYRO.especificidades = {
  nenhuma:    { label: "PYRO.Tecnica.Espec.nenhuma",    pontos: 0, filtro: "" },
  alcance:    { label: "PYRO.Tecnica.Espec.alcance",    pontos: 1, filtro: "alcance" },
  familia:    { label: "PYRO.Tecnica.Espec.familia",    pontos: 2, filtro: "familia" },
  tipo:       { label: "PYRO.Tecnica.Espec.tipo",       pontos: 3, filtro: "tipo" },
  especifica: { label: "PYRO.Tecnica.Espec.especifica", pontos: 4, filtro: "ataque" }
};

/**
 * Quanto vale mexer no número de ações de uma técnica (SRD Técnicas).
 *
 * Não é um por ação: o que pesa é a fração do turno que a mudança representa.
 * Sair de 1 para 2 ações dobra o custo do golpe, e por isso devolve muito;
 * sair de 4 para 5 acrescenta um quarto, e devolve pouco. Descer é o caminho
 * inverso, e cobra na mesma proporção — uma técnica que faz em 1 ação o que a
 * arma faz em 2 é o que há de mais caro.
 *
 *   subir[n]   pontos que a técnica ganha ao ir de n para n+1 ações
 *   descer[n]  pontos que ela gasta ao ir de n para n-1
 *
 * De 5 para 6 vale o mesmo que de 4 para 5, e não menos: seis ações são o
 * turno inteiro, e abrir mão dele custa mais do que a fração sugere.
 */
PYRO.custoDeAcoes = {
  1: { subir: 5 },
  2: { subir: 3, descer: 5 },
  3: { subir: 2, descer: 3 },
  4: { subir: 1, descer: 2 },
  5: { subir: 1, descer: 1 },
  6: { descer: 1 }
};

/** Um turno tem seis ações: é o teto do que uma técnica pode custar. */
PYRO.ACOES_MAX_TECNICA = 6;

/**
 * Pontos que a diferença entre as ações da arma e as da técnica rende. Positivo
 * quando a técnica é mais lenta que a arma (sobra ponto), negativo quando é
 * mais rápida (custa ponto). Cada degrau é cobrado no seu próprio preço, então
 * ir de 3 para 1 ação custa o degrau 3→2 mais o degrau 2→1.
 */
PYRO.pontosDeAcoes = (base, alvo) => {
  const teto = PYRO.ACOES_MAX_TECNICA;
  const de = Math.min(teto, Math.max(1, Math.round(Number(base) || 0)));
  const para = Math.min(teto, Math.max(1, Math.round(Number(alvo) || 0)));
  let total = 0;
  for (let n = de; n < para; n++) total += PYRO.custoDeAcoes[n]?.subir ?? 0;
  for (let n = de; n > para; n--) total -= PYRO.custoDeAcoes[n]?.descer ?? 0;
  return total;
};


/**
 * Opções de cada filtro automático. Alcance e família saem de números que a
 * arma já tem (alcance máximo e custo em ações), então o jogador escolhe a
 * condição e o sistema separa as armas sozinho — nada de marcar arma por arma.
 * O filtro "tipo" é montado no i18nInit, porque inclui os tipos de dano.
 */
PYRO.filtrosEspecificidade = {
  alcance: {
    corpoACorpo: "PYRO.Tecnica.Filtro.corpoACorpo",
    distante: "PYRO.Tecnica.Filtro.distante"
  },
  familia: {
    leve: "PYRO.Tecnica.Filtro.leve",
    media: "PYRO.Tecnica.Filtro.media",
    pesada: "PYRO.Tecnica.Filtro.pesada"
  }
};

/** Ataque desarmado como opção do filtro de tipo, ao lado dos tipos de dano. */
PYRO.FILTRO_DESARMADO = "desarmado";

/** Opções do filtro de tipo: os tipos de dano da arma, mais o desarmado. */
PYRO.opcoesFiltroTipo = () => ({
  ...Object.fromEntries(Object.entries(PYRO.tiposDano).map(([k, v]) => [k, v.label])),
  [PYRO.FILTRO_DESARMADO]: "PYRO.Tecnica.Filtro.desarmado"
});

/**
 * Traços (SRD Técnicas). Cada linha diz o que o traço rende e onde ele cabe:
 *
 *   grupo     agrupa a lista na ficha (ofensivo, mobilidade, defesa).
 *   bases     ações base compatíveis; vazio aceita qualquer uma.
 *   base      o que o grau 1 rende com Esforço 1.
 *   porGrau   quanto o grau seguinte acrescenta à base.
 *   unidade   texto do que o número é ("m", "dados", "x dados de dano").
 *   regra     comportamento que o código aplica além do número; sem `regra` o
 *             traço é só o número no card, que é o caso da maioria.
 *
 * O mestre edita tudo isso em Configurações > Traços de técnica: um traço novo
 * é uma linha a mais aqui, sem código novo — só os quatro com `regra` precisam
 * do sistema para valer.
 */
const traco = (grupo, base, porGrau, unidade, extra = {}) =>
  ({ grupo, base, porGrau, unidade, bases: [], ...extra });

const OFENSIVAS = ["atacar", "agarrar"];

PYRO.tracosTecnicaPadrao = {
  // Ofensivos (ação base Atacar ou Agarrar).
  // Um quarto de multiplicador por vez: os dados da arma só crescem quando o
  // acumulado fecha um 1x inteiro (ver multiplicarDados).
  potencia:     traco("ofensivo", 0.25, 0.25, "PYRO.Tecnica.Un.multDano", { bases: OFENSIVAS, regra: "danoMult" }),
  area:         traco("ofensivo", 1, 1, "PYRO.Tecnica.Un.raio", { bases: OFENSIVAS }),
  cone:         traco("ofensivo", 2, 1, "PYRO.Tecnica.Un.cone", { bases: OFENSIVAS }),
  linha:        traco("ofensivo", 2, 1, "PYRO.Tecnica.Un.linha", { bases: OFENSIVAS }),
  alcance:      traco("ofensivo", 1, 1, "PYRO.Tecnica.Un.metros", { bases: OFENSIVAS, regra: "mira" }),
  alvos:        traco("ofensivo", 1, 1, "PYRO.Tecnica.Un.alvos", { bases: OFENSIVAS }),
  empurrao:     traco("ofensivo", 1, 1, "PYRO.Tecnica.Un.metros", { bases: OFENSIVAS }),
  // O grau 1 é o teste em si; os dados extras começam no grau 2.
  derrubar:     traco("ofensivo", 0, 1, "PYRO.Tecnica.Un.dadosTeste", { bases: OFENSIVAS }),
  sangramento:  traco("ofensivo", 1, 1, "PYRO.Tecnica.Un.sangramento", { bases: OFENSIVAS }),
  quebraGuarda: traco("ofensivo", 1, 1, "PYRO.Tecnica.Un.bloqueioIgnorado", { bases: OFENSIVAS }),
  atordoar:     traco("ofensivo", 1, 1, "PYRO.Tecnica.Un.minutos", { bases: OFENSIVAS }),
  // Começa em desvantagem: o grau 2 zera e o 3 já é vantagem.
  desarmar:     traco("ofensivo", -1, 1, "PYRO.Tecnica.Un.vantagens", { bases: OFENSIVAS }),

  // Mobilidade e utilidade (qualquer ação base).
  passo:        traco("mobilidade", 2, 2, "PYRO.Tecnica.Un.metros"),
  corrida:      traco("mobilidade", 2, 2, "PYRO.Tecnica.Un.metros", { bases: ["mover"] }),
  salto:        traco("mobilidade", 2, 1, "PYRO.Tecnica.Un.multSalto"),
  vertical:     traco("mobilidade", 2, 2, "PYRO.Tecnica.Un.metrosVertical"),
  queda:        traco("mobilidade", 1, 1, "PYRO.Tecnica.Un.dadosQueda"),
  arrombar:     traco("mobilidade", 1, 1, "PYRO.Tecnica.Un.dadosForca"),
  silencioso:   traco("mobilidade", 1, 1, "PYRO.Tecnica.Un.dadosFurtividade"),

  // Reação e defesa (ação base Bloquear ou Esquivar).
  guarda:       traco("defesa", 1, 1, "PYRO.Tecnica.Un.dadosBloqueio", { bases: ["bloquear"], regra: "bloqueio" }),
  evasao:       traco("defesa", 1, 1, "PYRO.Tecnica.Un.dadosEsquiva", { bases: ["esquivar"], regra: "esquiva" }),
  firmeza:      traco("defesa", 1, 1, "PYRO.Tecnica.Un.dadosFirmeza")
};

// O nome de cada traço segue a chave, então não vale repeti-lo linha a linha
// na tabela acima — o mestre pode reescrevê-lo na tela de configuração.
for (const [chave, cfg] of Object.entries(PYRO.tracosTecnicaPadrao)) {
  cfg.label = `PYRO.Tecnica.Traco.${chave}`;
}

PYRO.tracosTecnica = foundry.utils.deepClone(PYRO.tracosTecnicaPadrao);

/**
 * Pontos fracos (SRD Técnicas): limitações aceitas na criação que devolvem
 * pontos. Acumulam entre si.
 */
PYRO.onusTecnicaPadrao = {
  posturaUnica:  { label: "PYRO.Tecnica.Onus.posturaUnica",  pontos: 2 },
  alvoNoChao:    { label: "PYRO.Tecnica.Onus.alvoNoChao",    pontos: 1 },
  custaPv:       { label: "PYRO.Tecnica.Onus.custaPv",       pontos: 3, regra: "custaPv" },
  umaVezPorCena: { label: "PYRO.Tecnica.Onus.umaVezPorCena", pontos: 3 }
};

PYRO.onusTecnica = foundry.utils.deepClone(PYRO.onusTecnicaPadrao);

/** Custo acumulado de um grau (SRD Técnicas): 1, 3, 6, 10, 15... */
PYRO.custoDoGrau = grau => {
  const g = Math.max(0, Math.round(Number(grau) || 0));
  return (g * (g + 1)) / 2;
};

/**
 * Estamina de um traço no Esforço N (SRD Técnicas): N x (N + 1), ou seja
 * 2, 6, 12, 20, 30 — o custo do nível anterior mais o nível atual duas vezes.
 */
PYRO.custoDoEsforco = esforco => {
  const e = Math.max(0, Math.round(Number(esforco) || 0));
  return e * (e + 1);
};

/**
 * Tabela de Subjulgar: o multiplicador sai da diferença de DET entre quem
 * conjura e quem recebe (usuário − alvo).
 *
 * A ordem é a das linhas no chat, do alvo mais forte para o mais fraco. As
 * duas pontas são abertas e por isso marcadas com `faixa`: contra alguém dois
 * pontos de DET acima ou mais a magia não faz nada, e a partir de cinco pontos
 * abaixo o multiplicador para de crescer.
 *
 * Multiplicador e linha moram juntos de propósito: em duas listas, mexer numa
 * e esquecer a outra seria um erro que ninguém veria na mesa.
 */
PYRO.faixasSubjulgar = [
  { dif: -2, mult: 0,    faixa: "acima" },
  { dif: -1, mult: 0.25 },
  { dif:  0, mult: 0.5 },
  { dif:  1, mult: 1 },
  { dif:  2, mult: 2 },
  { dif:  3, mult: 4 },
  { dif:  4, mult: 5 },
  { dif:  5, mult: 10,   faixa: "abaixo" }
];

/** Multiplicador de Subjulgar por diferença de DET (usuário − alvo). */
PYRO.multiplicadorSubjulgar = dif => {
  // Fora das pontas vale a ponta: a tabela não continua além delas.
  const primeira = PYRO.faixasSubjulgar[0];
  const ultima = PYRO.faixasSubjulgar[PYRO.faixasSubjulgar.length - 1];
  const d = Math.min(ultima.dif, Math.max(primeira.dif, Math.round(dif ?? 0)));
  return PYRO.faixasSubjulgar.find(f => f.dif === d)?.mult ?? 0;
};

/**
 * Condições do sistema (SRD §11; Desmaiado vem de Subjulgar). Registradas em
 * CONFIG.statusEffects no init: aparecem no HUD do token e o construtor de
 * efeitos as aplica via statuses. O comportamento mecânico de cada uma ainda
 * não existe — por ora são marcadores visíveis no token e na ficha.
 */
PYRO.condicoes = {
  queimando: { label: "PYRO.Condicoes.queimando", img: "icons/svg/fire.svg" },
  molhado:   { label: "PYRO.Condicoes.molhado",   img: "icons/svg/acid.svg" },
  friagem:   { label: "PYRO.Condicoes.friagem",   img: "icons/svg/frozen.svg" },
  irritado:  { label: "PYRO.Condicoes.irritado",  img: "icons/svg/combat.svg" },
  inseguro:  { label: "PYRO.Condicoes.inseguro",  img: "icons/svg/downgrade.svg" },
  apavorado: { label: "PYRO.Condicoes.apavorado", img: "icons/svg/terror.svg" },
  culpado:   { label: "PYRO.Condicoes.culpado",   img: "icons/svg/degen.svg" },
  insensato: { label: "PYRO.Condicoes.insensato", img: "icons/svg/daze.svg" },
  abatido:   { label: "PYRO.Condicoes.abatido",   img: "icons/svg/unconscious.svg" },
  confuso:   { label: "PYRO.Condicoes.confuso",   img: "icons/svg/stoned.svg" },
  desmaiado: { label: "PYRO.Condicoes.desmaiado", img: "icons/svg/unconscious.svg" },
  // Limiares de vida (SRD Atributos): metade e um quarto. Não fazem nada por
  // si — são o gancho de habilidades que reagem a um aliado ferido.
  ensanguentado: { label: "PYRO.Condicoes.ensanguentado", img: "icons/svg/blood.svg" },
  machucado: { label: "PYRO.Condicoes.machucado", img: "icons/svg/bones.svg" },
  // Acumula em níveis: cada nível tira 1 de todos os testes (ver efeitos.mjs).
  exausto:   { label: "PYRO.Condicoes.exausto",   img: "icons/svg/sleep.svg" }
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
  /*
   * Reação conta dado, não ponto: o valor da linha é quantos dados entram a
   * mais na rolagem. As faces já são as do sistema, então "+2" no bloqueio é
   * mais 2d4 e o botão passa a mostrar o total somado.
   */
  reacoes: {
    label: "PYRO.Efeitos.Cat.reacoes",
    alvos: {
      "system.bloqueioBonus": "PYRO.Efeitos.Alvo.bloqueioBonus",
      "system.esquivaBonus": "PYRO.Efeitos.Alvo.esquivaBonus"
    }
  },
  condicao: {
    label: "PYRO.Efeitos.Cat.condicao",
    alvos: Object.fromEntries(Object.entries(PYRO.condicoes)
      .map(([k, cfg]) => [k, cfg.label]))
  },
  /*
   * Dano não é uma alteração de campo do ator: é uma rolagem a mais que entra
   * no ataque ou na magia. Por isso a linha guarda uma fórmula ("2d6+2") no
   * lugar do valor, e o "alvo" é o tipo de dano. Fica na mesma lista para o
   * jogador não ter que aprender uma segunda tela.
   */
  dano: {
    label: "PYRO.Efeitos.Cat.dano",
    alvos: {
      "": "PYRO.Efeitos.DanoHerdado",
      ...Object.fromEntries(Object.entries(PYRO.tiposDano).map(([k, cfg]) => [k, cfg.label]))
    }
  },
  /*
   * Custo de usar alguma coisa: ações e os recursos que o sistema realmente
   * cobra hoje. PV e Força de Vontade não entram porque nada os cobra como
   * custo, e recurso personalizado idem — opção morta na lista é ruído.
   */
  custo: {
    label: "PYRO.Efeitos.Cat.custo",
    alvos: {
      acoes: "PYRO.Acoes",
      mana: "PYRO.Recursos.mana",
      estamina: "PYRO.Recursos.estamina",
      energia: "PYRO.Recursos.energia"
    }
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
      "system.maos": "PYRO.Efeitos.Alvos.maos",
      // Conta degraus na escada das línguas, não pontos de fator: +1 sobe
      // humano para élfico em tudo que o potencial decide.
      "system.potencialBonus": "PYRO.Efeitos.Alvo.potencialBonus"
    }
  }
};

/**
 * Tipos de mudança dos efeitos; as chaves são as do núcleo (texto, não modo
 * numérico). "upgrade" é o piso ("no mínimo X") e "downgrade" o teto — os
 * rótulos traduzem isso, não o nome interno.
 */
PYRO.modosEfeito = {
  add: "PYRO.Efeitos.Modo.somar",
  multiply: "PYRO.Efeitos.Modo.multiplicar",
  override: "PYRO.Efeitos.Modo.substituir",
  upgrade: "PYRO.Efeitos.Modo.minimo",
  downgrade: "PYRO.Efeitos.Modo.maximo"
};

/** Guia rápido de ações (SRD §5). */
PYRO.guiaAcoes = [
  "atacar", "mirar", "mover", "sacarArma", "tomarAr", "salto", "agarrar",
  "escalar", "furtividade", "bloquear", "esquivar", "cobertura",
  "atrasar", "ajudar", "foraDoTurno"
];
