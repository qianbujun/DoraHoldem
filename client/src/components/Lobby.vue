<template>
  <div class="w-full max-w-4xl mx-auto flex flex-col gap-6 p-4 sm:p-6 animate-fade-in">
    <!-- 未登录提示与快捷注册/登录卡片 -->
    <div v-if="!user" class="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col items-center text-center max-w-md mx-auto">
      <div class="text-4xl mb-2">🎴</div>
      <h2 class="text-xl font-black text-amber-400 mb-1">
        {{ isRegister ? $t('lobby.register') : $t('lobby.login') }}
      </h2>
      <p class="text-xs text-slate-400 mb-6">
        轻量极速对战，免邮箱验证码校验
      </p>

      <form @submit.prevent="handleAuthSubmit" class="w-full flex flex-col gap-3">
        <!-- 邮箱 -->
        <input
          v-model="authForm.email"
          type="email"
          required
          :placeholder="$t('lobby.email')"
          class="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-amber-400 text-slate-100"
        />

        <!-- 昵称 (注册时显示) -->
        <input
          v-if="isRegister"
          v-model="authForm.username"
          type="text"
          required
          :placeholder="$t('lobby.username')"
          class="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-amber-400 text-slate-100"
        />

        <!-- 密码 -->
        <input
          v-model="authForm.password"
          type="password"
          required
          :placeholder="$t('lobby.passwordInput')"
          class="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-amber-400 text-slate-100"
        />

        <button
          type="submit"
          class="w-full mt-2 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm transition shadow-lg"
        >
          {{ isRegister ? $t('lobby.register') : $t('lobby.login') }}
        </button>
      </form>

      <div class="mt-4 text-xs text-slate-400">
        <button
          @click="isRegister = !isRegister"
          class="text-amber-400 hover:underline font-bold"
        >
          {{ isRegister ? '已有账号？点击登录' : '没有账号？立即注册' }}
        </button>
      </div>
    </div>

    <!-- 已登录大厅主体 -->
    <template v-else>
      <!-- 大厅功能栏：创建房间 & 加入房间 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- 1. 创建对战房间 -->
        <div class="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div class="flex items-center gap-2 mb-3">
              <span class="text-xl">🏠</span>
              <h3 class="font-bold text-base sm:text-lg text-amber-400">
                {{ $t('lobby.createRoom') }}
              </h3>
            </div>

            <!-- 人数选择 (2~5人) -->
            <div class="flex flex-col gap-1.5 mb-3">
              <label class="text-xs text-slate-300 font-semibold">{{ $t('lobby.playerCount') }}</label>
              <div class="grid grid-cols-4 gap-2">
                <button
                  v-for="p in [2, 3, 4, 5]"
                  :key="p"
                  type="button"
                  @click="setPlayerCount(p)"
                  class="py-2 rounded-xl text-xs font-bold border transition"
                  :class="createForm.maxPlayers === p ? 'bg-amber-500 border-amber-400 text-slate-950' : 'bg-slate-800 border-slate-700 text-slate-300'"
                >
                  {{ p }} 人
                </button>
              </div>
            </div>

            <!-- 设定总局数（必须为人数的整倍数） -->
            <div class="flex flex-col gap-1.5 mb-3">
              <div class="flex items-center justify-between">
                <label class="text-xs text-slate-300 font-semibold">{{ $t('lobby.totalRounds') }}</label>
                <span class="text-[10px] text-amber-400 font-mono">（必须为 {{ createForm.maxPlayers }} 的整倍数）</span>
              </div>
              <div class="grid grid-cols-4 gap-2">
                <button
                  v-for="multiplier in [1, 2, 3, 4]"
                  :key="multiplier"
                  type="button"
                  @click="createForm.totalRounds = createForm.maxPlayers * multiplier"
                  class="py-2 rounded-xl text-xs font-bold border transition"
                  :class="createForm.totalRounds === createForm.maxPlayers * multiplier ? 'bg-amber-500 border-amber-400 text-slate-950' : 'bg-slate-800 border-slate-700 text-slate-300'"
                >
                  {{ createForm.maxPlayers * multiplier }} 局
                </button>
              </div>
              <span class="text-[10px] text-slate-400 mt-0.5">
                {{ $t('lobby.roundsNotice') }}
              </span>
            </div>

            <!-- 房间密码 -->
            <div class="flex flex-col gap-1 mb-4">
              <label class="text-xs text-slate-300 font-semibold">{{ $t('lobby.password') }}</label>
              <input
                v-model="createForm.password"
                type="text"
                :placeholder="$t('lobby.passwordPlaceholder')"
                class="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-amber-400"
              />
            </div>
          </div>

          <button
            @click="handleCreateRoom"
            class="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm transition shadow-lg"
          >
            {{ $t('lobby.submitCreate') }}
          </button>
        </div>

        <!-- 2. 快速输入房间号加入 -->
        <div class="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div class="flex items-center gap-2 mb-3">
              <span class="text-xl">🚀</span>
              <h3 class="font-bold text-base sm:text-lg text-teal-400">
                {{ $t('lobby.fastJoin') }}
              </h3>
            </div>

            <!-- 表单包裹并加入防自动填充机制，阻断浏览器账号密码管理器误填 -->
            <form
              autocomplete="off"
              @submit.prevent="handleJoinRoom(joinCode, joinPassword)"
              class="flex flex-col gap-3 my-4"
            >
              <!-- 阻断字段：吸收浏览器的激进凭据嗅探 -->
              <input type="text" name="fake_username_prevent" style="display:none" aria-hidden="true" autocomplete="off" />
              <input type="password" name="fake_password_prevent" style="display:none" aria-hidden="true" autocomplete="off" />

              <!-- 房间代码输入框 -->
              <input
                v-model="joinCode"
                type="text"
                name="room_join_code_search"
                id="room_join_code_search"
                autocomplete="off"
                autocapitalize="characters"
                spellcheck="false"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                maxlength="8"
                placeholder="输入 6 位房间代码 (如 8K9L2M)"
                class="uppercase text-center tracking-widest text-lg font-black px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-amber-300 focus:outline-none focus:border-teal-400"
              />

              <!-- 房间密码输入框 (默认以 text 呈现，提供掩码切换，彻底根除凭据填充) -->
              <div class="relative flex items-center">
                <input
                  v-model="joinPassword"
                  :type="maskJoinPassword ? 'password' : 'text'"
                  name="room_join_pass_token"
                  id="room_join_pass_token"
                  autocomplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  :placeholder="$t('lobby.passwordPlaceholder')"
                  class="w-full px-4 py-2.5 pr-10 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-teal-400"
                />
                <button
                  type="button"
                  @click="maskJoinPassword = !maskJoinPassword"
                  class="absolute right-3 text-slate-400 hover:text-slate-200 text-xs select-none p-1"
                  :title="maskJoinPassword ? '显示密码明文' : '隐藏密码为密文'"
                >
                  {{ maskJoinPassword ? '🔒' : '👁️' }}
                </button>
              </div>

              <button
                type="submit"
                :disabled="!joinCode"
                class="w-full mt-2 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-xs sm:text-sm transition shadow-lg"
              >
                {{ $t('lobby.join') }}
              </button>
            </form>
          </div>
        </div>
      </div>

      <!-- 3. 公开房间列表 -->
      <div class="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col gap-4">
        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
          <div class="flex items-center gap-2">
            <span class="text-xl">🌐</span>
            <h3 class="font-bold text-base text-slate-200">
              {{ $t('lobby.roomList') }}
            </h3>
          </div>
          <button
            @click="fetchRooms"
            class="text-xs px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold transition flex items-center gap-1"
          >
            <span>🔄</span>
            <span>{{ $t('lobby.refresh') }}</span>
          </button>
        </div>

        <div v-if="loadingRooms" class="py-8 text-center text-slate-500">
          加载房间列表中...
        </div>
        <div v-else-if="roomList.length === 0" class="py-8 text-center text-slate-500 text-xs">
          当前暂无等待中的公开房间，快来创建一间吧！
        </div>
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          <div
            v-for="rm in roomList"
            :key="rm.code"
            class="p-4 rounded-2xl bg-slate-800/60 border border-slate-700/60 hover:border-amber-400/60 transition flex flex-col justify-between gap-3"
          >
            <div class="flex items-center justify-between">
              <span class="font-mono font-black text-amber-400 text-base">#{{ rm.code }}</span>
              <span class="text-xs text-slate-400">
                {{ rm.playerCount }} / {{ rm.maxPlayers }} 人
              </span>
            </div>

            <div class="flex items-center justify-between text-xs text-slate-400">
              <span>总局数: {{ rm.totalRounds }} 局</span>
              <span v-if="rm.hasPassword" class="text-amber-300">🔒 需密码</span>
              <span v-else class="text-emerald-400">🔓 公开</span>
            </div>

            <button
              @click="handleJoinRoom(rm.code)"
              class="w-full py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition shadow"
            >
              {{ $t('lobby.join') }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';

const props = defineProps<{
  user: any;
}>();

const emit = defineEmits<{
  (e: 'login-success', user: any, token: string): void;
  (e: 'join-room', code: string, password?: string): void;
}>();

const isRegister = ref(false);
const authForm = reactive({
  email: '',
  username: '',
  password: '',
});

const createForm = reactive({
  maxPlayers: 4,
  totalRounds: 4,
  password: '',
});

const joinCode = ref('');
const joinPassword = ref('');
const maskJoinPassword = ref(false);

const roomList = ref<any[]>([]);
const loadingRooms = ref(false);

function setPlayerCount(count: number) {
  createForm.maxPlayers = count;
  createForm.totalRounds = count; // 默认倍数 1
}

async function handleAuthSubmit() {
  const url = isRegister.value ? '/api/auth/register' : '/api/auth/login';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authForm),
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem('dora_token', data.token);
      emit('login-success', data.user, data.token);
    } else {
      alert(data.error || 'Authentication failed');
    }
  } catch (err: any) {
    alert(err.message);
  }
}

async function handleCreateRoom() {
  const token = localStorage.getItem('dora_token');
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(createForm),
    });
    const data = await res.json();
    if (res.ok) {
      emit('join-room', data.code, createForm.password || undefined);
    } else {
      alert(data.error);
    }
  } catch (err: any) {
    alert(err.message);
  }
}

function handleJoinRoom(code: string, password?: string) {
  emit('join-room', code.toUpperCase().trim(), password);
}

async function fetchRooms() {
  loadingRooms.value = true;
  try {
    const res = await fetch('/api/rooms');
    if (res.ok) {
      roomList.value = await res.json();
    }
  } catch (e) {
    console.error(e);
  } finally {
    loadingRooms.value = false;
  }
}

onMounted(() => {
  fetchRooms();
});
</script>

