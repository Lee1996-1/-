import { initializeApp } from "[https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js](https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js)";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "[https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js](https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js)";
// doc, setDoc, getDoc을 추가하여 공유 메타데이터(제목) 처리
import { getFirestore, collection, addDoc, onSnapshot, query, serverTimestamp, setLogLevel, doc, setDoc } from "[https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js](https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js)";

// Firestore 및 Auth 객체를 전역에서 사용하기 위해 window 객체에 할당
window.firebase = {
    db: null,
    auth: null,
    userId: null
};
// 최신 로드된 코멘트 데이터를 다운로드 기능에서 사용하기 위해 전역 변수로 저장
window.latestComments = []; 

// Firestore 보안 규칙에 따른 Public 데이터 경로 설정
const getCommentsCollectionPath = (appId) => `/artifacts/${appId}/public/data/reflection_comments`;
const getBoardMetadataDocRef = (db, appId) => doc(db, `/artifacts/${appId}/public/data/metadata`, 'board_info');

// 1. Firebase 설정 및 초기화
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
setLogLevel('Debug'); // 디버그 로그 활성화

window.firebase.db = db;
window.firebase.auth = auth;

const authPromise = new Promise(resolve => {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // 인증 완료 후 사용자 ID 설정
            window.firebase.userId = user.uid;
            document.getElementById('current-user-id').textContent = user.uid;
            resolve(true);
        } else {
            // 초기 인증 처리 (Custom Token 우선 사용, 없으면 익명 로그인)
            const token = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
            try {
                if (token) {
                    await signInWithCustomToken(auth, token);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (error) {
                console.error("Firebase Auth Error:", error);
                // 인증 실패 시, 임의의 ID를 사용하여 최소한의 기능 유지 (공유 데이터 저장은 불가)
                window.firebase.userId = `Anon-${crypto.randomUUID()}`;
                document.getElementById('current-user-id').textContent = `인증 오류: ${window.firebase.userId}`;
                resolve(false);
            }
        }
    });
});

// 2. 공유 보드 제목 로드 및 실시간 업데이트
window.loadBoardTitle = async () => {
    await authPromise;
    if (!window.firebase.db) return;

    const boardTitleInput = document.getElementById('board-title-input');
    const boardTitleRef = getBoardMetadataDocRef(db, appId);

    onSnapshot(boardTitleRef, (docSnap) => {
        const defaultTitle = '새로운 스터디/독후감 보드';
        if (docSnap.exists()) {
            const data = docSnap.data();
            const title = data.title || defaultTitle;
            
            // 입력 필드와 표시 영역 모두 업데이트
            boardTitleInput.value = title;
            document.getElementById('board-title-display').textContent = title;
        } else {
            // 문서가 없으면 기본값 설정
            boardTitleInput.value = defaultTitle;
            document.getElementById('board-title-display').textContent = defaultTitle;
        }
    });
};

// 3. 공유 보드 제목 저장 (입력 필드 포커스가 벗어날 때 자동 저장)
window.saveBoardTitle = async (event) => {
    await authPromise;
    const newTitle = event.target.value.trim();
    
    // 제목이 비어있거나, Firebase가 준비되지 않았으면 저장하지 않음
    if (newTitle.length < 1) return;
    if (!window.firebase.db || !window.firebase.userId) return;

    const boardTitleRef = getBoardMetadataDocRef(db, appId);
    try {
        // setDoc을 merge: true로 사용하여 다른 필드는 유지하고 title만 업데이트
        await setDoc(boardTitleRef, {
            title: newTitle,
            updatedAt: serverTimestamp(),
            updatedBy: window.firebase.userId
        }, { merge: true });
        alertBox.show('보드 제목이 업데이트되었습니다.', 'success');
    } catch (e) {
        console.error("Error updating board title: ", e);
        alertBox.show('제목 업데이트 중 오류가 발생했습니다: ' + e.message, 'error');
    }
};


// 4. 코멘트 제출 함수
window.submitComment = async () => {
    await authPromise; // 인증이 완료될 때까지 대기

    const submitButton = document.querySelector('button[onclick="submitComment()"]');
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="spinner mr-2"></span> 제출 중...';

    const nameInput = document.getElementById('author-name');
    const commentType = document.querySelector('input[name="comment-type"]:checked');
    const commentInput = document.getElementById('comment-text');

    const name = nameInput.value.trim();
    const type = commentType ? commentType.value : null;
    const comment = commentInput.value.trim();

    if (!name || !type || !comment) {
        alertBox.show('모든 항목(이름, 유형, 내용)을 채워주세요.', 'error');
        submitButton.disabled = false;
        submitButton.innerHTML = '🚀 제출하기';
        return;
    }

    if (!window.firebase.db || !window.firebase.userId) {
        alertBox.show('데이터베이스 연결/인증 대기 중입니다. 잠시 후 다시 시도해 주세요.', 'warning');
        submitButton.disabled = false;
        submitButton.innerHTML = '🚀 제출하기';
        return;
    }

    try {
        const docRef = await addDoc(collection(db, getCommentsCollectionPath(appId)), {
            name: name,
            type: type,
            comment: comment,
            timestamp: serverTimestamp(),
            authorId: window.firebase.userId
        });

        alertBox.show('코멘트가 성공적으로 제출되었습니다.', 'success');
        // 입력 필드 초기화
        nameInput.value = name; // 이름은 유지
        commentInput.value = '';
        if (commentType) commentType.checked = false;

    } catch (e) {
        console.error("Error adding document: ", e);
        alertBox.show('코멘트 제출 중 오류가 발생했습니다: ' + e.message, 'error');
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = '🚀 제출하기';
    }
};

// 5. 실시간 코멘트 로드 함수
window.loadComments = async () => {
    await authPromise; // 인증이 완료될 때까지 대기

    if (!window.firebase.db) return;

    const commentsCollectionRef = collection(db, getCommentsCollectionPath(appId));
    const q = query(commentsCollectionRef);

    const impressiveContainer = document.getElementById('impressive-comments');
    const learnMoreContainer = document.getElementById('learn-more-comments');
    const difficultContainer = document.getElementById('difficult-comments');

    onSnapshot(q, (snapshot) => {
        let comments = {
            '인상깊은 부분': [],
            '더 알아보고 싶은 부분': [],
            '이해하기 어려웠던 부분': []
        };
        let allCommentsArray = []; // 다운로드를 위해 모든 코멘트를 담을 배열

        snapshot.forEach((doc) => {
            const data = doc.data();
            
            // 코멘트 객체 생성 및 타임스탬프 포맷
            const commentData = {
                id: doc.id,
                ...data,
                timestampFormatted: data.timestamp ? new Date(data.timestamp.toDate()).toLocaleString('ko-KR') : 'N/A'
            };

            if (comments[data.type]) {
                comments[data.type].push(commentData);
            }
            allCommentsArray.push(commentData); // 전역 변수에 저장할 데이터에 추가
        });
        
        // 최신 데이터를 전역 변수에 저장
        window.latestComments = allCommentsArray;

        // 타임스탬프를 기준으로 최신순 정렬 (timestamp는 Firestore Timestamp 객체이거나 null일 수 있음)
        for (const type in comments) {
            // 원본 timestamp 객체를 이용해 정렬
            comments[type].sort((a, b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0));
        }

        // 렌더링
        impressiveContainer.innerHTML = comments['인상깊은 부분'].map(createCommentCard).join('');
        learnMoreContainer.innerHTML = comments['더 알아보고 싶은 부분'].map(createCommentCard).join('');
        difficultContainer.innerHTML = comments['이해하기 어려웠던 부분'].map(createCommentCard).join('');

        checkEmptyState(comments['인상깊은 부분'].length, impressiveContainer, '인상깊은 부분');
        checkEmptyState(comments['더 알아보고 싶은 부분'].length, learnMoreContainer, '더 알아보고 싶은 부분');
        checkEmptyState(comments['이해하기 어려웠던 부분'].length, difficultContainer, '이해하기 어려웠던 부분');
    });
};

const checkEmptyState = (count, container, type) => {
     if (count === 0) {
        container.innerHTML = `<div class="p-4 text-center text-gray-500 italic">아직 ${type} 코멘트가 없습니다.</div>`;
    }
}

// 코멘트 카드 HTML 생성
const createCommentCard = (data) => {
    // data.timestampFormatted를 사용하지 않고 Firestore Timestamp를 사용하여 표시용 시간을 다시 계산
    const timestamp = data.timestamp ? new Date(data.timestamp.toDate()).toLocaleString('ko-KR', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }) : '방금 전';

    const isCurrentUser = data.authorId === window.firebase.userId;
    const authorTextClass = isCurrentUser ? 'font-semibold text-blue-600' : 'text-gray-700';
    const cardBorderColor = isCurrentUser ? 'border-l-4 border-blue-500' : 'border-l-4 border-gray-200';

    return `
        <div class="comment-card p-4 bg-white rounded-xl ${cardBorderColor} mb-4 shadow-md">
            <p class="text-gray-800 mb-2 whitespace-pre-wrap">${data.comment}</p>
            <div class="flex justify-between items-center text-sm mt-3 pt-2 border-t border-gray-100">
                <span class="${authorTextClass} text-xs">
                    ${data.name} <span class="text-gray-400">| ${data.authorId.substring(0, 8)}...</span>
                </span>
                <span class="text-gray-400 text-xs">${timestamp}</span>
            </div>
        </div>
    `;
};

// 6. 데이터 다운로드 기능 (CSV)
window.downloadCommentsAsCSV = () => {
    const comments = window.latestComments;

    if (!comments || comments.length === 0) {
        alertBox.show('다운로드할 코멘트가 없습니다.', 'warning');
        return;
    }

    // CSV 헤더 정의
    const headers = ["ID", "작성자 이름", "유형", "내용", "작성 시간 (KST)", "작성자 ID"];

    // CSV 내용 생성
    let csvContent = headers.join(',') + '\n';

    comments.forEach(comment => {
        // 특수 문자 처리 (쉼표와 줄바꿈을 이스케이프)
        const escapeCSV = (value) => {
            if (value === null || value === undefined) return '';
            // 문자열로 변환 후, 따옴표를 이중 따옴표로 이스케이프하고 전체를 따옴표로 감쌈
            let str = String(value);
            if (str.includes(',') || str.includes('\n') || str.includes('"')) {
                str = str.replace(/"/g, '""');
                str = `"${str}"`;
            }
            return str;
        };

        const row = [
            escapeCSV(comment.id),
            escapeCSV(comment.name),
            escapeCSV(comment.type),
            escapeCSV(comment.comment),
            escapeCSV(comment.timestampFormatted),
            escapeCSV(comment.authorId)
        ].join(',');
        
        csvContent += row + '\n';
    });

    // 다운로드 실행
    const bom = "\ufeff"; // BOM (Byte Order Mark) for Korean compatibility in Excel
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    // 파일명 생성: 보드 제목 또는 기본 제목 + 날짜
    const boardTitle = document.getElementById('board-title-input').value.trim() || '피드백보드';
    const now = new Date();
    const dateStr = now.getFullYear() + (now.getMonth() + 1).toString().padStart(2, '0') + now.getDate().toString().padStart(2, '0');
    
    a.href = url;
    a.download = `${boardTitle}_${dateStr}_코멘트.csv`;
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url); // 메모리 해제
    
    alertBox.show('코멘트 데이터 다운로드를 시작합니다.', 'success');
};

// Custom Alert/Message Box
const alertBox = {
    element: document.getElementById('custom-alert'),
    timeout: null,
    show: function(message, type) {
        clearTimeout(this.timeout);
        this.element.textContent = message;
        this.element.className = 'fixed right-4 top-4 p-4 rounded-lg text-white shadow-xl transition-transform transform translate-x-0';
        
        let bgColor = 'bg-blue-600';
        if (type === 'error') bgColor = 'bg-red-600';
        if (type === 'warning') bgColor = 'bg-yellow-600';
        if (type === 'success') bgColor = 'bg-green-600';

        this.element.classList.add(bgColor);

        this.timeout = setTimeout(() => {
            this.hide();
        }, 4000);
    },
    hide: function() {
        this.element.classList.remove('translate-x-0');
        this.element.classList.add('translate-x-[150%]');
        setTimeout(() => {
            this.element.textContent = '';
            this.element.className = 'hidden';
        }, 500);
    }
};

// 7. 페이지 로드 시 코멘트와 제목 로드 시작
window.onload = () => {
    window.loadComments();
    window.loadBoardTitle();
};
